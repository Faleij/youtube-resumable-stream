'use strict';

var googleauth = require('google-auth-cli');
var ResumableUpload = require('../index.js');
var google_secrets = require('./secrets.json');
var fs = require('fs');

var stream = require('stream');

var tokens;

var upload = function() {
    var metadata = {
        snippet: {
            title: 'New Upload 2',
            description: 'Uploaded with ResumableUpload'
        },
        status: {
            privacyStatus: 'private'
        }
    };
    var resumableUpload = new ResumableUpload(); //create new ResumableUpload
    resumableUpload.tokens = tokens;
    resumableUpload.filepath = './replace.mp4';
    resumableUpload.metadata = metadata;
    resumableUpload.monitor = true;
    resumableUpload.size = fs.statSync(resumableUpload.filepath).size;
    resumableUpload.retry = -1; //infinite retries, change to desired amount
    resumableUpload.eventEmitter.on('progress', function(progress) {
        console.log(progress);
    });
    resumableUpload
        .on('success', function(result) {
            //success handler
            console.log(result);
        })
        .on('error', function(error) {
            //error handler
            console.log('Upload failed');
            console.log(JSON.stringify(error));
        });
    fs.createReadStream(resumableUpload.filepath).pipe(resumableUpload);
};

var getTokens = function(callback) {
    googleauth({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/youtube.upload' //can do just 'youtube', but 'youtube.upload' is more restrictive
        }, {
            client_id: google_secrets.client_id, //replace with your client_id and _secret
            client_secret: google_secrets.client_secret,
            port: 3000
        },
        function(err, authClient, tokens) {
            console.log(tokens);
            callback(tokens);
        });
};

getTokens(function(result) {
    console.log('tokens:' + result);
    tokens = result;
    upload();
});