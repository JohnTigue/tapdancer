'use strict';

/* This is simply to have some trivial Lambda to tickle in order to
 * confirm deploys working at SOME level. Also useful for checking
 * what is going on between client and Lambda in, say, API-GW
 */
        
const moment = require('moment-timezone');

module.exports.checkSanity = (event, context, callback) => {
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
