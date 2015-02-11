'use strict';

var fs = require('fs');
var request = require('request');
var mime = require('mime');
var PassThrough = require('stream').PassThrough;
var inherits = require('util').inherits;
var contentRange = require('content-range');

function ResumableUpload(serializedState) {
	this.byteCount = 0; //init variables
	this.size = 0;
	this.tokens = {};
	this.filepath = '';
	this.metadata = {};
	this.monitor = false;
	this.retry = -1;
	if (serializedState) {
		this.deserialize(serializedState);
	}
	PassThrough.call(this);
	this.setMaxListeners(30);
	this.once('readable', this.initUpload.bind(this));
}

inherits(ResumableUpload, PassThrough);

ResumableUpload.prototype.serialize = function() {
	return {
		byteCount: this.byteCount,
		size: this.size,
		tokens: this.tokens,
		filepath: this.filepath,
		metadata: this.metadata,
		monitor: this.monitor,
		retry: this.retry,
		location: this.location
	};
};

ResumableUpload.prototype.deserialize = function(data) {
	Object.keys(data).forEach(function (key) {
		this[key] = data[key];
	});
	return this;
};

ResumableUpload.prototype.initUpload = function() {
	var self = this;
	// resume if location is available
	if (self.location) {
		return self.putUpload();
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
					return self.emit('error', new Error(body.error));
				}
			}
			self.location = response.headers.location;
			self.putUpload();
		} else {
			self.emit('error', new Error(error));
		}
	});
};

//Pipes uploadPipe to self.location (Google's Location header)
ResumableUpload.prototype.putUpload = function() {
	var self = this;
	
	if (self.monitor) { //start monitoring (defaults to false)
		self.startMonitoring();
	}
	
	var options = {
		url: self.location, //self.location becomes the Google-provided URL to PUT to
		headers: {
			'Authorization': 'Bearer ' + self.tokens.access_token,
			'Content-Length': parseInt(self.size, 10) - self.byteCount,
			'Content-Type': mime.lookup(self.filepath)
		}
	};
	
	if (self.byteCount > 0) {
		options.headers['Content-Range'] = contentRange.format({
			name: 'bytes',
			offset: parseInt(self.byteCount, 10),
			limit: parseInt(self.size, 10) - self.byteCount,
			count: parseInt(self.size, 10)
		});
	}
	
	try {
		this.pipe(request.put(options, function(error, response, body) {
			if (error) {
				self.emit('error', error);

				// Allow unlimited retries
				if (self.retry === -1) {
					self.getProgress(function() {
						self.initUpload();
					});
				} else if (self.retry > 0) {
					self.retry--;
					self.getProgress(function() {
						self.initUpload();
					});
				}

				return;
			}

			self.emit('success', body, response);
		}));

		self.emit('ready');
	} catch (error) {
		self.emit('error', error);

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
				self.emit('progress', response.headers.range.split('-')[1] + '/' + fs.statSync(self.filepath).size);
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
		if (error) {
			console.log(error);
			return cb(error);
		}
		try {
			self.byteCount = parseInt(response.headers.range.split('-')[1], 10); //parse response
		} catch (e) {
			return cb(e);
		}
		cb(null, response);
	});
};

module.exports = ResumableUpload;