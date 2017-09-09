(() => {
'use strict';

const Promise = require('bluebird');
const JSFtp   = require('jsftp');
const path    = require('path');
  
let fileOpts = {
  localFileName: path.resolve(__dirname, 'junk_text.txt'),
  };
 
let ftpOpts = {
  host: 'tigue.com',
  user: 'tigue',
  password: '43cts21',
  destFilename: '/public_html/chuckscd/junk_text.txt'
  };
  
let Ftp = new JSFtp({
  host: ftpOpts.host,
  user: ftpOpts.user,
  pass: ftpOpts.password,
  port: 21
  });
    
module.exports.testFtp = (event, context, callback) => {
  let response = {
    statusCode: 200
    };

  console.log('fileOpts.localFileName = ' + fileOpts.localFileName);
  Ftp.put(fileOpts.localFileName, ftpOpts.destFilename, (hadError) => {
    if (hadError) {
      console.error('ftp put errored:' + hadError);
      response.body = JSON.stringify({
        message: ('ftp put errored:' + hadError),
        input: event
        });
      } else {
        console.log('ftp put ok');
        response.body = JSON.stringify({
          message: ('ftp put ok'),
          input: event
          });
        }

    setTimeout(function() {
      if (Ftp) {
        Ftp.destroy();
        Ftp = null;
        }

      }, 50);   
    
    callback(null, response);
    });
  };
})();






