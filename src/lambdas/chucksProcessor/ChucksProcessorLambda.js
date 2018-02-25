/* This code screen scrapes chucks.com beer menu from HTML to JSON
 * (and the JSON is persisted to S3 and made publicly available).  It
 * also generates a very simple (but sortable) HTML page which is made
 * available on the web.
 * 
 * The artifact destination depends on the stage, see
 * src/configuration.js for details
 * 
 * License: MIT
 * Author: John Tigue (john@tigue.com)
 */
(() => {
  "use strict";
  // TODO: turn this into modern JS and webpack it for deploy to Lambda

  const config = require("../../configuration").configuration;

  //let globalCallback = null;

  const Promise = require("bluebird");

  const AWS = require("aws-sdk");
  AWS.config.setPromisesDependency(require("bluebird"));

  const cheerio = require("cheerio");
  const fs = Promise.promisifyAll(require("fs"));
  const moment = require("moment-timezone");
  const s3 = new AWS.S3();
  const s3urls = require("s3urls");
  const webFetch = require("request-promise");

  const $ = cheerio.load(""); //TODO: is this needed?

  let Ftp = null;

  // https://github.com/nknapp/promised-handlebars
  global.Promise = Promise;
  let promisedHandlebars = require("promised-handlebars");
  let Handlebars = promisedHandlebars(require("handlebars"));
  Handlebars.registerHelper("formatDate", function(context) {
    return moment(context).tz(config.taps.location.timeZoneNameForMomentJs).format("M/DD hha");
  });
  
  
  let extractBeerInfo = anEl => {
    let anId = parseInt($(anEl).find(".draft_tap").text());
    //console.log('tap# ' + anId);

    let aBrewer = $(anEl).find(".draft_brewery").text();
    //console.log('brewer:' + aBrewer);

    let aBeerName =  $(anEl).find(".draft_name").text();
    //console.log('brew:' + aBeerName);

    let aGrowlerPrice = 0;
    let rawGrowlerPrice = $(anEl).find(".draft_growler").text();
    let noGrowlersAvailable = false;
    if (rawGrowlerPrice !== "N/A") {
      try {
        aGrowlerPrice = parseFloat(rawGrowlerPrice);//.slice(1));
      } catch(e) {
        console.error( "couldn't parseFloat(" + rawGrowlerPrice + ")" );
        aGrowlerPrice = 0.00;
        noGrowlersAvailable = true;
      }
      //console.log(rawGrowlerPrice + " => " + aGrowlerPrice);
    } else {
      noGrowlersAvailable = true;
    }

    let pintPrice = parseFloat(
      $(anEl).find(".draft_price").text().slice(1)
    );

    let aBeerType = "-";
    if ($(anEl).hasClass("cider")) {
      aBeerType = "Cider";
    }
    if ($(anEl).hasClass("ipa")) {
      aBeerType = "IPA";
    }
    if ($(anEl).hasClass("sour")) {
      aBeerType = "Sour";
    }
    if ($(anEl).hasClass("stout")) {
      aBeerType = "Stout";
    }

    /* Two features together show if a tapOffering is actually for (default) 16oz pint, or 8oz for special beers
     *   1. Price of growler is way more than 3x pint (normally growler is 3:1 pint, special case will be close to 6:1)
     *   2. Name actually tagged with **8oz** or ***8oz***
     * So, could just go by "*8oz* in name", alone without looking for pricing oddness
     *
     * Also note that Issue #15 found that the special case pricing math is looser than strict 6x pricing 
     * Examples: $6.50/$38.00, $9.00/$56.00, and $7.00/$41.00
     */
    let isPintPriceActuallyFor8oz = false;
    // old way, using math detection: if(Math.ceil(5 * pintPrice) < aGrowlerPrice); // they round up the price of (3 X pint) so 5x is a good threshold

    let shortyRegexp = /(\*+8oz\*+)/;
    if(shortyRegexp.test(aBeerName)){
      isPintPriceActuallyFor8oz = true;
      // remove *8oz* from name
      aBeerName = aBeerName.replace(shortyRegexp, "");
    }

    // TODO: kill old code
    // highlight odd pricing of growler but not if pint is probably an 8oz
    //let oddPricing = false;
    //if (!isProbably8oz) {
    //  oddPricing = Math.ceil(3 * pintPrice) !== aGrowlerPrice;
    //}

    let alcoolVolume = parseFloat($(anEl).find(".draft_abv").text());
    if(isNaN(alcoolVolume)){
      alcoolVolume = 0.0;
    }
    //console.info($(anEl).find(".draft_abv").text() + " => " + alcoolVolume);

    let aBeerOrigin = $(anEl).find(".draft_origin").text();
    //console.info(aBeerOrigin);
    
    let onceOfAlcoolPerDollar = 16 * (alcoolVolume / 100) / pintPrice;
    // console.error( onceOfAlcoolPerDollar);

    // TODO: problem is that if aGrowlerPrice = 0 then cannot detect (by check if 3xPint ~ Growler) that a pint is actually 8oz
    // So, hack is to grey out AB$ and give a warning.
    let uncertainAlcoolPerDollar = false;
    //console.log(aBeerName + ' g=' + aGrowlerPrice);
    if (aGrowlerPrice == 0) {
      uncertainAlcoolPerDollar = true;
    } else {
      if (isPintPriceActuallyFor8oz) {
        //console.log('    ...Caught it');
        // then we have both growler and pint pricing and its odd which means we have caclulated onceOfAlcoolPerDollar for 16oz when it needs to be for 8
        onceOfAlcoolPerDollar = onceOfAlcoolPerDollar / 2;
      }
    }

    return {
      id: anId, // tap #
      brewery: aBrewer,
      beerName: aBeerName,
      origin: aBeerOrigin,
      beerType: aBeerType,
      alcoolVolume: alcoolVolume.toFixed(1),

      pintPrice: pintPrice.toFixed(2),
      isPintPriceActuallyFor8oz: isPintPriceActuallyFor8oz,
      growlerPrice: aGrowlerPrice.toFixed(2),
      noGrowlersAvailable: noGrowlersAvailable,

      onceOfAlcoolPerDollar: onceOfAlcoolPerDollar.toFixed(2),
      uncertainAlcoolPerDollar: uncertainAlcoolPerDollar

      // TODO: cull?
      //oddPricing: oddPricing, // TODO: not used, so kill
      //growlerToPintRatio: (aGrowlerPrice / pintPrice).toFixed(1) // TODO: I think this is not used
    };
  };

  let timestampUnknownBeers = (previousBeers, currentBeers) => {
    let oldBeerCount = 0;

    currentBeers.forEach(aCurrentBeer => {
      let matchingPreviousBeer = previousBeers.find(aPreviousBeer => {
        // brewery-plus-beerName can be used as a unique key to compare for
        return (
          aCurrentBeer.beerName === aPreviousBeer.beerName &&
          aCurrentBeer.brewery === aPreviousBeer.brewery
        );
      });
      if(matchingPreviousBeer != null) {
        oldBeerCount++;
      }
      if (matchingPreviousBeer && matchingPreviousBeer.tapDateTime != null) {
        // TODO: Kill, eventually when all old format instances are gone
        // Could be the old format, like:
        //   aCurrentBeer.tapDateTime = "2/18@14h"
        let maybeOldFormatMoment = moment(matchingPreviousBeer.tapDateTime, "M/DD[@]HH[h]");
        //console.log( "..is valid: " + maybeOldFormatMoment.isValid() + ": " + maybeOldFormatMoment.format());
        if(maybeOldFormatMoment.isValid()) {
          // ...use old but reformat
          aCurrentBeer.tapDateTime = maybeOldFormatMoment.format(); // TODO: what is right format? And string? or other?
        } else {
          // ...assume is new format
          aCurrentBeer.tapDateTime = matchingPreviousBeer.tapDateTime;
        }
      } else {
        console.log("Found new beer: " + aCurrentBeer.beerName);
        aCurrentBeer.tapDateTime = moment().format();
        //console.log('NEW beer @ ' + aCurrentBeer.tapDateTime);
      }
    });
    // then for each currentBeer, get it's time stamp from its corresponding previousBeer
    // if there is no corresponding previousBeer then generate new timeStamp
    console.log("Checked timestamps of current and previous lists... known beers: " + oldBeerCount);

    return currentBeers;
  };

  let doYourThing = () => {
    return webFetch("http://chucks-cd.jjshanks.net/draft")
      .then(chucksHtmlString => {
        // Process html... into list of beers
        //console.log(htmlString);
        let mainPage = $.load(chucksHtmlString);

        //console.log(".draft_list = " + mainPage("#draft_list").get().length);

        let leftBeerEls = mainPage("#draft_list")
          .find("tr")
          .filter(".draft_even, .draft_odd") //this filters out the header, which has no class; all beers are either draft_even or draft_odd
          .map((i, el) => {
            return extractBeerInfo(el);
          });

        console.log('Polling chucks website... Fetched current draft html. Beers found in html = ' + leftBeerEls.get().length);
        let beers = leftBeerEls.get();
        return beers;
      })
      .then(currentBeers => {
        // read beers.json from S3, find unknown beers and add timestamp, write to S3
        let anUrl = config.beersJson.s3Url;

        if (!s3urls.valid(anUrl)) {
          console.log("bad S3 URL for beersJson: " + anUrl);
          return Promise.reject("bad S3 URL for beersJson: " + anUrl);
        } else {
          let s3Deets = s3urls.fromUrl(anUrl);
          //console.log('Key:' + s3Deets.Key + ' Bucket:' + s3Deets.Bucket);
          let beersJsonParams = { Bucket: s3Deets.Bucket, Key: s3Deets.Key };
          var getBeersDotJson = s3.getObject(beersJsonParams).promise();
          return getBeersDotJson
            .then(data => {
              console.log("Fetching previous taplist... getBeersDotJson seems to have worked.");
              //console.log(data.Body.toString());
              return data.Body.toString();
            })
            .then(previousBeersDotJsonContents => {
              let previousBeers = JSON.parse(previousBeersDotJsonContents);
              console.log(
                'JSON.parse(beers.json\'s contents) went ok. previousBeers.length = ' +
                  previousBeers.length
              );
              currentBeers = timestampUnknownBeers(previousBeers, currentBeers);
              let beersAsJson = JSON.stringify(currentBeers);
              let putParams = {
                Body: beersAsJson,
                Bucket: s3Deets.Bucket,
                Key: s3Deets.Key,
                ContentType: "application/json",
                ACL: "public-read"
              };
              console.log("Now to S3 put new beersAsJson...");
              var putBeersDotJson = s3.putObject(putParams).promise();
              return putBeersDotJson
                .then(() => {
                  console.log(
                    "...put to S3 worked. Proceeding with " +
                      currentBeers.length +
                      " beers to html render."
                  );
                  return currentBeers;
                })
                .catch(err => {
                  console.log("putBeersDotJson errored " + err);
                  return Promise.reject(err);
                });
            })
            .catch(err => {
              console.log("getBeersDotJson chain errored " + err);
              return Promise.reject(err);
            });
        }
      })
      .then(currentBeers => {
        // Read html template from FS, Handlebar that with currentBeers, write renderedMenuPage to FS,
        // TODO: Great. But why is menuRenderedString what is returned?
        console.log("Next, Handlebars render " + currentBeers.length + " beers.");
        return fs
          .readFileAsync(config.menuTemplateRelativeFilename, "utf8")
          .then(menuTemplateString => {
            let menuTemplate = Handlebars.compile(menuTemplateString);

            // this is used to timestamp the generated page
            currentBeers.nowDateTime = moment()
              .tz(config.taps.location.timeZoneNameForMomentJs)
              .format("M/D[@]HH[:]mm");

            return menuTemplate(currentBeers).then(menuRenderedString => {
              //console.log(menuRenderedString);
              return fs
                .writeFileAsync(
                  config.menuRendered.localFilename,
                  menuRenderedString,
                  "utf8"
                )
                .then(() => {
                  console.log("...write menuRenderedString to FS went ok.");
                  return menuRenderedString;
                })
                .catch(err => {
                  console.error(
                    "ERROR fs.writeFileAsync(" +
                      config.menuRendered.localFilename +
                      "): " +
                      err
                  );
                  return Promise.reject(err);
                });
            });
          })
          .catch(err => {
            console.log("handlebars errored: " + err);
            return Promise.reject(err);
          });
      })
      .then(menuRenderedString => {
        // S3.putObject() the menuRenderedString
        let putDestS3Url = config.menuRendered.s3Url;
        if (!s3urls.valid(putDestS3Url)) {
          // not sure how we could ever get to this case but, hey why not check anyway
          console.error("bad S3 URL: " + putDestS3Url);
          return Promise.reject("bad S3 URL: " + putDestS3Url);
        } else {
          let s3Deets = s3urls.fromUrl(putDestS3Url);
          //console.log('Key:' + s3Deets.Key + ' Bucket:' + s3Deets.Bucket);
          let menuS3DestParams = { Bucket: s3Deets.Bucket, Key: s3Deets.Key };

          let putParams = {
            Body: menuRenderedString,
            Bucket: s3Deets.Bucket,
            Key: s3Deets.Key,
            ContentType: "text/html",
            ACL: "public-read"
          };
          var putMenuHtml = s3.putObject(putParams).promise();
          return putMenuHtml
          .then(() => {
            console.log(
              "...putObject(menu as s3://" + s3Deets.Bucket + "/" + s3Deets.Key + ") to S3 worked."
            );
            return "Who cares? Put is done.";
          })
          .catch(err => {
            console.log("putBeersDotJson errored " + err);
            return Promise.reject(err);
          });
        }
      })
      .catch(err => {
        console.log("main webFetch() catch :" + err);
        return Promise.reject(err);
      })
      .then(() => {
        /* TODO: kill, probably harmless cannot be helping.
        setTimeout(function() {
          if (Ftp) {
            Ftp.destroy();
            Ftp = null;
          }
        }, 50);
        */
      });
  };

  exports.pollForUpdates = function(event, context, callback) {
    //globalCallback = callback;

    console.log(
      "----------------------\npollForUpdates() invoked at " +
        moment().tz(config.taps.location.timeZoneNameForMomentJs).format("M/D[@]HH[:]mm")
    );

    //console.log(event);
    // Determine who invoked this genie.
    // See https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-api-gateway-request
    if(event["detail-type"] == "Scheduled Event") {
      console.log("Seemingly invoked via Scheduled Event");
    } else if(event["requestContext"] != null) {
      console.log("Seemingly invoked via API GW");
    } else {
      let error = new Error("Unknown invokation type");
      console.error(error);
      callback(true, error);
    };
    
    //in serverless-offline, callback() does not seem to end execution, so explicitly return
    //callback();    
    //return;

    doYourThing()
      .then(() => {
        console.log("Invokation seems to have run to success.");
        let responseHtml = `<html><body>Refresh succeeded.</body></html>`;
        
        // https://github.com/serverless/examples/tree/master/aws-node-serve-dynamic-html-via-http-endpoint
        const response = {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/html',
          },
          body: responseHtml,
        };

        // TODO: maybe it's weird to return HTML to scheduled events but seemingly harmless
        callback(null, response);
      })
      .catch(error => {
        console.error("Main doYourThing() was caught.");
        console.error(error);
        callback(true, error);        
      })
    ;
  };
})();
