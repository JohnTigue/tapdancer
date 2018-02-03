/* This file upgrades chuckscd.com beer menu from HTML to JSON (and the JSON is persisted to S3 and made publicly available).
 * It also generates a very simple (but sortable) HTML page.
 * 
 * License: MIT
 * Author: John Tigue (john@tigue.com)
 */
(()=> {
'use strict';

let globalCallback = null;  
  
let fileOpts = {
  menuTemplateFilename: 'templates/menu2html.hbs',
  menuRenderedFilename: '/tmp/index.html',
  beersAsJsonFilename: '/tmp/beers.json',
  beersAsJsonInS3: 's3://chucksmenu/beers.json'
  };
  
const Promise  = require('bluebird');

const AWS      = require('aws-sdk');
  AWS.config.setPromisesDependency(require('bluebird'));

const s3       = new AWS.S3();
const s3urls   = require('s3urls');
  
const cheerio  = require('cheerio');
const fs       = Promise.promisifyAll(require('fs'));
const moment   = require('moment');
const webFetch = require('request-promise');

// works on osx but not lambda
//const PromiseFtp = require('promise-ftp');
const JSFtp = require('jsftp');
    
const $ = cheerio.load(''); //TODO: is this needed?

// not in lambda sadly: let ftp = new PromiseFtp();
let ftpOpts = {
  host: 'tigue.com',
  user: 'tigue',
  password: '43cts21',
  destFilename: '/public_html/chuckscd/index.html'
  };

let Ftp = new JSFtp({
  host: ftpOpts.host,
  user: ftpOpts.user,
  pass: ftpOpts.password
  });
   
// https://github.com/nknapp/promised-handlebars
global.Promise = Promise;
let promisedHandlebars = require('promised-handlebars');
let Handlebars = promisedHandlebars(require('handlebars'));
  
let extractBeerInfo = (anEl) => {
  //console.log($(el).children());
  let threeLines = $(anEl).contents()['0'].data.split('\n');
  //console.log(threeLines);
  let anId = parseInt(threeLines[1]);
  let aBrewer = threeLines[2].trim();
  let aBeerName = threeLines[3].trim();

  let aGrowlerPrice = 0;
  let rawGrowlerPrice = $(anEl).find('.beer_meta_xlarge').text();
  if(rawGrowlerPrice !== 'N/A') {
    aGrowlerPrice = parseFloat(rawGrowlerPrice.slice(1));
    }

  let pintPrice = parseFloat($(anEl).find('.beer_meta_small').text().slice(1));

  let aBeerType = '-';
  if($(anEl).hasClass('cider')) {
    aBeerType = 'Cider';
    };
  if($(anEl).hasClass('ipa')) {
    aBeerType = 'IPA';
    };
  if($(anEl).hasClass('sour')) {
    aBeerType = 'Sour';
    };
  if($(anEl).hasClass('stout')) {
    aBeerType = 'Stout';
    };

  // if a growler is 6x a "pint" then the pint is probably 8oz
  let isProbably8oz = (Math.ceil(6 * pintPrice) == aGrowlerPrice);  // they round up the price of (3 X pint)
  //console.log( Math.ceil(6 * pintPrice) + ' == ' +  aGrowlerPrice);
  //if(isProbably8oz) console.log('^^^^^^^^^^^');


  // highlight odd pricing of growler but not if pint is probably an 8oz
  let oddPricing = false;
  if(!isProbably8oz) {
    oddPricing = (Math.ceil(3 * pintPrice) !== aGrowlerPrice);
    }

  let alcoolVolume = parseFloat($(anEl).find('.beer_meta_big').text());
  let onceOfAlcoolPerDollar = (16*(alcoolVolume/100))/pintPrice;
  // console.error( onceOfAlcoolPerDollar);

  // TODO: problem is that if aGrowlerPrice = 0 then cannot detect (by check if 3xPint ~ Growler) that a pint is actually 8oz 
  // So, hack is to grey out AB$ and give a warning.
  let uncertainAlcoolPerDollar = false;
  //console.log(aBeerName + ' g=' + aGrowlerPrice);
  if(aGrowlerPrice == 0) {
    uncertainAlcoolPerDollar = true;
    //console.log('   0checking oddPricing:' + oddPricing);
    } else {
      //console.log('    checking oddPricing:' + oddPricing);
      if(isProbably8oz) {
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
    oddPricing: oddPricing,
    doublePricing: isProbably8oz,
    growlerToPintRatio: (aGrowlerPrice / pintPrice).toFixed(1),  // TODO: I think this is not used
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
      return (aCurrentBeer.beerName === aPreviousBeer.beerName) && (aCurrentBeer.brewery === aPreviousBeer.brewery)
      });
    if(matchingPreviousBeer) {
      //console.log( 'found old ' + matchingPreviousBeer.beerName );
      if(matchingPreviousBeer.tapDateTime) {
        aCurrentBeer.tapDateTime = matchingPreviousBeer.tapDateTime;
        } else {
          aCurrentBeer.tapDateTime = new Date().toISOString();
          };
      oldBeerCount++;
      } else {
        console.log( 'found NEW ' + aCurrentBeer.beerName );
	aCurrentBeer.tapDateTime = moment().format('M/D[@]H[h]');
        }
    });
  // then for each currentBeer, get it's time stamp from its corresponding previousBeer
  // if there is no corresponding previousBeer then generate new timeStamp
  console.log('oldBeerCount=' + oldBeerCount);
		       
  return currentBeers;
  };

  
  
let doYourThing = () => {        	  
  return webFetch('http://cd.chucks85th.com/')
    .then(chucksHtmlString => {
      // Process html... into list of beers
      //console.log(htmlString);
      let mainPage = $.load(chucksHtmlString);
      let leftBeerEls = mainPage('#draft_left').find('li').not('.header').map((i, el) => {
        return extractBeerInfo(el);
        });
      let rightBeerEls = mainPage('#draft_right').find('li').not('.header').map((i, el) => {
        return extractBeerInfo(el);
      });
      //console.log('left=' + leftBeerEls.get().length + ' right=' + rightBeerEls.get().length); 
      let beers = leftBeerEls.get().concat(rightBeerEls.get()); 
      return beers;
      })
    .then(currentBeers => {
      // read beers.json from FS, find unknown beers, add timestamp, write to FS
//s3get
      return fs.readFileAsync(fileOpts.beersAsJsonFilename, "utf8")
	.then(previousBeersDotJsonContents => {
	  let previousBeers = JSON.parse(previousBeersDotJsonContents);
	  currentBeers = timestampUnknownBeers(previousBeers, currentBeers);
          let beersAsJson = JSON.stringify(currentBeers);	  
          return fs.writeFileAsync(fileOpts.beersAsJsonFilename, beersAsJson, "utf8").then(() => {
	    console.log('wrote ' + fileOpts.beersAsJsonFilename);
	    return currentBeers;
	    });	  
        });
      })
    .then((currentBeers) => {
      // render JS => JSON => HTML via Handlebars
      //console.log(beers.length);
      return fs.readFileAsync(fileOpts.menuTemplateFilename, "utf8")
        .then(menuTemplateString => {
          let menuTemplate = Handlebars.compile(menuTemplateString);
          return menuTemplate(currentBeers).done((menuRenderedString) => {
      	  //console.log(menuRenderedString);
            return fs.writeFileAsync(fileOpts.menuRenderedFilename, menuRenderedString, "utf8").then(() => {return menuRenderedString;});
            });
          })
        .catch(err => {
  	console.log('handlebars errored: ' + err);
  	throw err;
          });
      })
    .then((menuRenderedString) => {
      console.log(menuRenderedString);
      return fs.readFileAsync(fileOpts.menuTemplateFilename, "utf8")
        .then((menuTemplateString) => {
          return new Promise(function(resolve, reject) {
            Ftp.put(fileOpts.menuRenderedFilename, ftpOpts.destFilename, (hadError) => {
              //Ftp.destroy();
              //Ftp = null;
              if (hadError)
                reject(hadError);
  	      resolve();
            });  
      /* works on osx but not lambda
      return gftp
        .connect({host: ftpOpts.host, user: ftpOpts.user, password: ftpOpts.password})
        .then((serverMessage) => {
          return ftp.put(fileOpts.menuRenderedFilename, ftpOpts.destFilename);
          })
        .then(() => {
          console.log('FTP went well seemingly');	  
          return ftp.end();
          });
       */ });
	});
      })
    .catch(err => {
      console.log('webFetch():' + err);
      throw err;
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
    console.log('done');
    callback();
    });
  };

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
	      return err;
	    });
          })
        .catch(err => {
          console.log(err);
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
  
// JFT-TODO: so then the init load of this code into lambda will run freshneMenu twice, no?
//exports.freshenMenu( {}, {}, () => console.log('done mimicking Lambad invoke'));  
})();
