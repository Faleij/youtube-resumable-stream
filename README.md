youtube-resumable-stream
=============================

Upload large videos to youtube via Google's 'resumable upload' API:
follows https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

Benchmarked with an 800mb video - this module bypasses the filesize restrictions on node's `fs.readFileSync()` (used by the official googleapis node client for uploading) by using `fs.createReadStream()` and then piping the stream to Youtube's servers.

How to Use
==========

Requires OAuth2 tokens from google - packages such as `googleapis` (the official nodejs client), `Passport` and `google-auth-cli` can be used.

Todo: Install with `npm install youtube-resumable-stream`

The module returns the video metadata that Google responds with on a successful upload.

Look at test/test.js for a use-case example, but this is the gist of it:
```javascript
var ResumableUpload = require('youtube-resumable-stream');
var resumableUpload = new ResumableUpload(); //create new ResumableUpload
var fs = require('fs');
resumableUpload.tokens = tokens; //Google OAuth2 tokens
resumableUpload.filepath = './video.mp4';
resumableUpload.metadata = metadata; //include the snippet and status for the video
resumableUpload.monitor = true;
resumableUpload.retry = 3; // Maximum retries when upload failed.
resumableUpload
	.on('success', function(result) {
		// success handler
		console.log(result);
	})
	.on('error', function(error) {
		// error handler - any type of error
		console.log(error);
	})
	.on('ready', function() {
		// resumableUpload will now begin to upload data to youtube
		// resumableUpload should now be saved with resumableUpload.serailize()
		// tokens will not be serialized for security reasons
		// use resumableUpload.deserialize(serializedData) to restore state and then pipe a stream to resume
	});
// resumableUpload initiates the upload when it has a readable stream
fs.createReadStream(resumableUpload.filepath).pipe(resumableUpload);
```
