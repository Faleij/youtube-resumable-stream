'use strict';

var fs = require('fs');
var request = require('request');
var EventEmitter = require('events').EventEmitter;
var mime = require('mime');
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var contentRange = require('content-range');

function ResumableUpload(transformOptions) {
	this.byteCount = 0; //init variables
	this.size = 0;
	this.tokens = {};
	this.filepath = '';
	this.metadata = {};
	this.monitor = false;
	this.retry = -1;
	Transform.call(this, transformOptions);
}

inherits(ResumableUpload, Transform);

ResumableUpload.prototype._transform = function(chunk, encoding, callback) {
	this.push(chunk, encoding);
	callback();
};

//Init the upload by POSTing google for an upload URL (saved to self.location)
ResumableUpload.prototype.eventEmitter = new EventEmitter();

ResumableUpload.prototype.initUpload = function(callback, errorback) {
	var self = this;
	// resume if location is available
	if (self.location) {
		return self.putUpload(callback, errorback);
	}
	var options = {
		url: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,contentDetails',
		headers: {
			'Host': 'www.googleapis.com',
			'Authorization': 'Bearer ' + this.tokens.access_token,
			'Content-Length': new Buffer(JSON.stringify(this.metadata)).length,
			'Content-Type': 'application/json',
			'X-Upload-Content-Length': this.size,
			'X-Upload-Content-Type': mime.lookup(this.filepath)
		},
		body: JSON.stringify(this.metadata)
	};
	//Send request and start upload if success
	request.post(options, function(error, response, body) {
		if (!error) {
			if (!response.headers.location && body) {
				// bad-token, bad-metadata, etc...
				body = JSON.parse(body);
				if (body.error) {
					console.log(JSON.stringify(body.error));
					if (errorback) {
						errorback(new Error(body.error));
					}
					return;
				}
			}
			self.location = response.headers.location;
			self.putUpload(callback, errorback);
		} else {
			if (errorback)
				errorback(new Error(error));
		}
	});
};

//Pipes uploadPipe to self.location (Google's Location header)
ResumableUpload.prototype.putUpload = function(callback, errorback) {
	var self = this;
	if (self.monitor) //start monitoring (defaults to false)
		self.startMonitoring();
	var options = {
		url: self.location, //self.location becomes the Google-provided URL to PUT to
		headers: {
			'Authorization': 'Bearer ' + self.tokens.access_token,
			'Content-Length': self.size - self.byteCount,
			'Content-Type': mime.lookup(self.filepath)
		}
	};
	if (self.byteCount) {
		options.headers['Content-Range'] = contentRange.format({
			name: 'bytes',
			offset: self.byteCount,
			limit: self.size-1,
			count: self.size
		});
	}
	try {
		this.pipe(request.put(options, function(error, response, body) {
			console.log('error', error);
			if (!error) {
				if (callback)
					callback(body);
			} else {
				if (errorback)
					errorback(new Error(error));
				if (self.retry > 0) {
					self.retry--;
					self.getProgress(function() {
						self.initUpload();
					});
				}
				// Allow unlimited retries
				if (self.retry === -1) {
					self.getProgress(function() {
						self.initUpload();
					});
				}
			}
		}));
	} catch (e) {
		//Restart upload
		if (self.retry > 0) {
			self.retry--;
			self.getProgress(function() {
				self.initUpload();
			});
		}
	}
};

//PUT every 5 seconds to get partial # of bytes uploaded
ResumableUpload.prototype.startMonitoring = function() {
	var self = this,
		healthCheckInterval;
	var options = {
		url: self.location,
		headers: {
			'Authorization': 'Bearer ' + self.tokens.access_token,
			'Content-Length': '0',
			'Content-Range': 'bytes */' + this.size
		}
	};
	var healthCheck = function() { //Get # of bytes uploaded
		request.put(options, function(error, response) {
			if (!error && response.headers.range !== undefined) {
				self.eventEmitter.emit('progress', response.headers.range.substring(8, response.headers.range.length) + '/' + fs.statSync(self.filepath).size);
				if (response.headers.range === this.size) {
					clearInterval(healthCheckInterval);
				}
			}
		});
	};
	healthCheckInterval = setInterval(healthCheck, 5000);
};

//If an upload fails, get partial # of bytes. Called by putUpload()
ResumableUpload.prototype.getProgress = function(cb) {
	var self = this;
	var options = {
		url: self.location,
		headers: {
			'Authorization': 'Bearer ' + self.tokens.access_token,
			'Content-Length': 0,
			'Content-Range': 'bytes */' + this.size
		}
	};
	request.put(options, function(error, response, body) {
		try {
			self.byteCount = response.headers.range.substring(8, response.headers.range.length); //parse response
		} catch (e) {
			//console.log('error');
			return cb(e);
		}
		cb();
	});
};

module.exports = ResumableUpload;