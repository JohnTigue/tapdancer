/* This has only one purpose: write a beers.json to test if it's a permissions thing that is preventing chucks_processor.js from putObject(~beers.json~)
 *
 * License: MIT
 * Author: John Tigue (john@tigue.com)
 */
(() => {
  "use strict";

  let globalCallback = null;

  const Promise = require("bluebird");

  const AWS = require("aws-sdk");
  AWS.config.setPromisesDependency(require("bluebird"));

  const cheerio = require("cheerio");
  const fs = Promise.promisifyAll(require("fs"));
  const moment = require("moment-timezone");
  const s3 = new AWS.S3();
  const s3urls = require("s3urls");
  const webFetch = require("request-promise");

  // https://github.com/nknapp/promised-handlebars
  global.Promise = Promise;

  let writeBeersDotJsonSeed = function() {
    return fs
      .readFileAsync("beers.seed-2017-09-10-01.json", "utf8")
      .then(beersDotJsonText => {
        console.log("Read /tmp/beers.seed-2017-09-10-01.json");
        console.log(beersDotJsonText.substring(0, 30));
        let putParams = {
          Body: beersDotJsonText,
          Bucket: "chucksmenu",
          Key: "beers.json",
          ContentType: "application/json",
          ACL: "public-read"
        };
        console.log("About to put beers.json");
        var putBeersDotJson = s3.putObject(putParams).promise();
        return putBeersDotJson
          .then(() => {
            console.log(
              "put to S3 worked."
            );
            return Promise.resolve();
          })
          .catch(err => {
            console.log("putBeersDotJson errored " + err);
            return Promise.reject(err);
          });          
      });
  };

  
  exports.seedBeersDotJson = function(event, context, callback) {
    globalCallback = callback;
    writeBeersDotJsonSeed().then(() => {
      console.log("done");
      callback();
    });
  };


  console.log(
    "run invoked at " +
      moment().tz("America/Los_Angeles").format("M/D[@]HH[:]mm")
  );
  // JFT-TODO: so then the init load of this code into lambda will run freshneMenu twice, no?

  // this is for invoking freshenMenu from localhost where it's triggered by, say, cron
  //exports.seedBeersDotJson({}, {}, () =>
  //  console.log("done mimicking Lambad invoke")
  //);


})();
