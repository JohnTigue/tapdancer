'use strict';

// This is junk. just used it to test moment().tz, locally and in Lambda

const moment   = require('moment-timezone');

module.exports.hello = (event, context, callback) => {
  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Noch ein Bier, Bitte!',
      moment: moment().tz('America/Los_Angeles').format('ddd, hA'),
      //momentNames: moment.tz.names(),
      input: event
      })
    };

  callback(null, response);

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // callback(null, { message: 'Go Serverless v1.0! Your function executed successfully!', event });
  };
