/* This file upgrades chuckscd.com beer menu from HTML to JSON (and the JSON is persisted to S3 and made publicly available).
 * It also generates a very simple (but sortable) HTML page.
 *
 * License: MIT
 * Author: John Tigue (john@tigue.com)
 */
(() => {
  "use strict";

  let globalCallback = null;

  let fileOpts = {
    menuTemplateFilename: "templates/menu2html.hbs",
    menuRenderedFilename: "/tmp/index.html",
    beersAsJsonFilename: "/tmp/beers.json",
    beersAsJsonInS3: "s3://chucksmenu/beers.json"
  };

  const Promise = require("bluebird");

  const AWS = require("aws-sdk");
  AWS.config.setPromisesDependency(require("bluebird"));

  const cheerio = require("cheerio");
  const fs = Promise.promisifyAll(require("fs"));
  const moment = require("moment-timezone");
  const s3 = new AWS.S3();
  const s3urls = require("s3urls");
  const webFetch = require("request-promise");

  // works on osx but not lambda
  //const PromiseFtp = require('promise-ftp');
  const JSFtp = require("jsftp");

  const $ = cheerio.load(""); //TODO: is this needed?

  // not in lambda sadly: let ftp = new PromiseFtp();
  let ftpOpts = {
    host: "tigue.com",
    user: "tigue",
    password: "43cts21",
    destFilename: "/public_html/chuckscd/index.html"
  };

  let Ftp = new JSFtp({
    host: ftpOpts.host,
    user: ftpOpts.user,
    pass: ftpOpts.password,
    port: 21
  });

  // https://github.com/nknapp/promised-handlebars
  global.Promise = Promise;
  let promisedHandlebars = require("promised-handlebars");
  let Handlebars = promisedHandlebars(require("handlebars"));

  let extractBeerInfo = anEl => {
    let anId = parseInt($(anEl).find(".draft_tap").text());
    //console.log('tap# ' + anId);

    let aBrewer = $(anEl).find(".draft_brewery").text();  
    //console.log('brewer:' + aBrewer);
    
    let aBeerName =  $(anEl).find(".draft_name").text();  
    //console.log('brew:' + aBeerName);

    let noGrowlersAvailable = false;
    let aGrowlerPrice = 0;
    let rawGrowlerPrice = $(anEl).find(".draft_growler").text();
    if (rawGrowlerPrice !== "N/A") {
      aGrowlerPrice = parseFloat(rawGrowlerPrice.slice(1));
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

    // if a growler is 6x a "pint" then the pint is probably 8oz
    let isProbably8oz = Math.ceil(6 * pintPrice) == aGrowlerPrice; // they round up the price of (3 X pint)
    //console.log( Math.ceil(6 * pintPrice) + ' == ' +  aGrowlerPrice);
    //if(isProbably8oz) console.log('^^^^^^^^^^^');

    // highlight odd pricing of growler but not if pint is probably an 8oz
    let oddPricing = false;
    if (!isProbably8oz) {
      oddPricing = Math.ceil(3 * pintPrice) !== aGrowlerPrice;
    }

    let alcoolVolume = parseFloat($(anEl).find(".draft_abv").text());
    let onceOfAlcoolPerDollar = 16 * (alcoolVolume / 100) / pintPrice;
    // console.error( onceOfAlcoolPerDollar);

    // TODO: problem is that if aGrowlerPrice = 0 then cannot detect (by check if 3xPint ~ Growler) that a pint is actually 8oz
    // So, hack is to grey out AB$ and give a warning.
    let uncertainAlcoolPerDollar = false;
    //console.log(aBeerName + ' g=' + aGrowlerPrice);
    if (aGrowlerPrice == 0) {
      uncertainAlcoolPerDollar = true;
      //console.log('   0checking oddPricing:' + oddPricing);
    } else {
      //console.log('    checking oddPricing:' + oddPricing);
      if (isProbably8oz) {
        //console.log('    ...Caught it');
        // then we have both growler and pint pricing and its odd which means we have caclulated onceOfAlcoolPerDollar for 16oz when it needs to be for 8
        onceOfAlcoolPerDollar = onceOfAlcoolPerDollar / 2;
      }
    }

    return {
      id: anId,
      brewery: aBrewer,
      beerName: aBeerName,
      beerType: aBeerType,
      pintPrice: pintPrice.toFixed(2),
      growlerPrice: aGrowlerPrice.toFixed(2),
      noGrowlersAvailable: noGrowlersAvailable,
      oddPricing: oddPricing,
      doublePricing: isProbably8oz,
      growlerToPintRatio: (aGrowlerPrice / pintPrice).toFixed(1), // TODO: I think this is not used
      alcoolVolume: alcoolVolume.toFixed(1),
      onceOfAlcoolPerDollar: onceOfAlcoolPerDollar.toFixed(2),
      uncertainAlcoolPerDollar: uncertainAlcoolPerDollar
    };
  };

  let timestampUnknownBeers = (previousBeers, currentBeers) => {
    let oldBeerCount = 0;

    currentBeers.forEach(aCurrentBeer => {
      let matchingPreviousBeer = previousBeers.find(aPreviousBeer => {
        // brew + brewer can be used as a unique key
        return (
          aCurrentBeer.beerName === aPreviousBeer.beerName &&
          aCurrentBeer.brewery === aPreviousBeer.brewery
        );
      });
      if (matchingPreviousBeer) {
        //console.log( 'found old ' + matchingPreviousBeer.beerName );
        if (matchingPreviousBeer.tapDateTime) {
          aCurrentBeer.tapDateTime = matchingPreviousBeer.tapDateTime;
        } else {
          aCurrentBeer.tapDateTime = new Date().toISOString();
        }
        oldBeerCount++;
      } else {
        console.log("found NEW " + aCurrentBeer.beerName);
        aCurrentBeer.tapDateTime = moment()
          .tz("America/Los_Angeles")
          .format("M/DD[@]HH[h]");
        //console.log('NEW beer @ ' + aCurrentBeer.tapDateTime);
      }
    });
    // then for each currentBeer, get it's time stamp from its corresponding previousBeer
    // if there is no corresponding previousBeer then generate new timeStamp
    console.log("oldBeerCount=" + oldBeerCount);

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

        console.log('# beers found in html = ' + leftBeerEls.get().length);
        let beers = leftBeerEls.get();

        /*
         This is from the pre-2017-09 menu which had two tables left and right
        let rightBeerEls = mainPage("#draft_right")
          .find("li")
          .not(".header")
          .map((i, el) => {
            return extractBeerInfo(el);
          });
        //console.log('left=' + leftBeerEls.get().length + ' right=' + rightBeerEls.get().length);
        let beers = leftBeerEls.get().concat(rightBeerEls.get());
         */
        
        return beers;
      })
      .then(currentBeers => {
        // read beers.json from S3, find unknown beers and add timestamp, write to S3
        let anUrl = fileOpts.beersAsJsonInS3;

        if (!s3urls.valid(anUrl)) {
          console.log("bad S3 URL: " + anUrl);
          return Promise.reject("bad S3 URL: " + anUrl);
        } else {
          let s3Deets = s3urls.fromUrl(anUrl);
          //console.log('Key:' + s3Deets.Key + ' Bucket:' + s3Deets.Bucket);
          let beersJsonParams = { Bucket: s3Deets.Bucket, Key: s3Deets.Key };
          var getBeersDotJson = s3.getObject(beersJsonParams).promise();
          return getBeersDotJson
            .then(data => {
              console.log("getBeersDotJson seems to have worked:");
              console.log(data.Body.toString());
              return data.Body.toString();
            })
            .then(previousBeersDotJsonContents => {
              let previousBeers = JSON.parse(previousBeersDotJsonContents);
              console.log(
                'JSON.parse("beers.json") ok: previousBeers.length = ' +
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
              var putBeersDotJson = s3.putObject(putParams).promise();
              return putBeersDotJson
                .then(() => {
                  console.log(
                    "put to S3 worked. returning " +
                      currentBeers.length +
                      " beers"
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
        console.log("about to Handlebar " + currentBeers.length + " beers");
        return fs
          .readFileAsync(fileOpts.menuTemplateFilename, "utf8")
          .then(menuTemplateString => {
            let menuTemplate = Handlebars.compile(menuTemplateString);

            // this is used to timestamp the generated page
            currentBeers.nowDateTime = moment()
              .tz("America/Los_Angeles")
              .format("M/D[@]HH[:]mm");

            return menuTemplate(currentBeers).then(menuRenderedString => {
              //console.log(menuRenderedString);
              return fs
                .writeFileAsync(
                  fileOpts.menuRenderedFilename,
                  menuRenderedString,
                  "utf8"
                )
                .then(() => {
                  console.log("write menuRenderedString to FS: ok");
                  return menuRenderedString;
                })
                .catch(err => {
                  console.error(
                    "ERROR fs.writeFileAsync(" +
                      fileOpts.menuRenderedFilename +
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
        // FTP put the rendered menu page to tigue.com/chuckscd
        console.log("mrs.length:" + menuRenderedString.length);
        return fs
          .readFileAsync(fileOpts.menuTemplateFilename, "utf8")
          .then(menuTemplateString => {
            return new Promise(function(resolve, reject) {
              console.log(
                "About to: Ftp.put(" +
                  fileOpts.menuRenderedFilename +
                  ", " +
                  ftpOpts.destFilename +
                  ")"
              );
              Ftp.put(
                fileOpts.menuRenderedFilename,
                ftpOpts.destFilename,
                hadError => {
                  if (hadError) {
                    console.log("ftp put errored:" + hadError);
                    reject(hadError);
                  }
                  console.log("ftp put ok");
                  resolve();
                }
              );
            })
              .catch(err => {
                console.log(err);
                return Promise.reject(err);
              })
              .then(() => {
                // can't destroy() it durning this round w/o errors
                setTimeout(function() {
                  if (Ftp) {
                    Ftp.destroy();
                    Ftp = null;
                  }
                }, 50);
              });
          });        
      })
      .catch(err => {
        console.log("main webFetch() catch :" + err);
        return Promise.reject(err);
      })
      .then(() => {
        setTimeout(function() {
          if (Ftp) {
            Ftp.destroy();
            Ftp = null;
          }
        }, 50);
      });
  };

  exports.freshenMenu = function(event, context, callback) {
    globalCallback = callback;
    doYourThing().then(() => {
      console.log("done");
      callback();
    });
  };

  /*
let testS3Read = () => {
  let anUrl = fileOpts.beersAsJsonInS3;
  if(!s3urls.valid(anUrl)) {
      console.log('bad URL: ' + anUrl);
    } else {
      let s3Deets = s3urls.fromUrl(anUrl);
      console.log('Key:' + s3Deets.Key + ' Bucket:' + s3Deets.Bucket);
      let beersJsonParams = {Bucket: s3Deets.Bucket, Key: s3Deets.Key};
      var getBeersDotJson = s3.getObject(beersJsonParams).promise();
      getBeersDotJson
        .then(data => {
          console.log(Object.keys(data));
          return data.Body.toString(); 
          })
        .then(beersAsJson => {
          let beers = JSON.parse(beersAsJson);
          console.log('beers.length=' + beers.length);
          beersJsonParams.Body = JSON.stringify(beers);
          var putBeersDotJson = s3.putObject(beersJsonParams).promise();
          putBeersDotJson
            .then(() => {
              console.log('put worked');
            })
            .catch(err => {
              console.log(err);
              return Promise.reject(err);
            });
          })
        .catch(err => {
          console.log(err);
          return Promise.reject(err);
          })
        .then(() => {
          setTimeout(function() {
            if (Ftp) {
               Ftp.destroy();
               Ftp = null;
               }
            }, 50);   
          });
      };
  };
testS3Read();
 */

  console.log(
    "run invoked at " +
      moment().tz("America/Los_Angeles").format("M/D[@]HH[:]mm")
  );
  // JFT-TODO: so then the init load of this code into lambda will run freshneMenu twice, no?
  exports.freshenMenu({}, {}, () =>
    console.log("done mimicking Lambad invoke")
  );
})();
