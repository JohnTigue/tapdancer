(()=> {
'use strict';

let fileOpts = {
  menuTemplateFilename: 'templates/menu2html.hbs',
  menuRenderedFilename: '/tmp/index.html',
  beersAsJsonFilename: '/tmp/beers.json'
  };
  
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

const cheerio    = require('cheerio');
const webFetch   = require('request-promise');
const PromiseFtp = require('promise-ftp');
  
const $ = cheerio.load('<h2 class = "title">Hello world</h2>');

let ftp = new PromiseFtp();

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

  let aBeerType = null;
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

  let pintPrice = parseFloat($(anEl).find('.beer_meta_small').text().slice(1));
  let alcoolVolume = parseFloat($(anEl).find('.beer_meta_big').text());
  let onceOfAlcoolPerDollar = (16*(alcoolVolume/100))/pintPrice;
  let oddPricing = (Math.ceil(3 * pintPrice) !== aGrowlerPrice);
  //  console.error( onceOfAlcoolPerDollar);
  
  return {
    id: anId,
    brewery: aBrewer,
    beerName: aBeerName,
    beerType: aBeerType,
    pintPrice: pintPrice.toFixed(2),
    growlerPrice: aGrowlerPrice.toFixed(2),
    oddPricing: oddPricing,
    growlerToPintRatio: (aGrowlerPrice / pintPrice).toFixed(1),
    alcoolVolume: alcoolVolume.toFixed(1),
    onceOfAlcoolPerDollar: onceOfAlcoolPerDollar.toFixed(2)
    };
  };


let doYourThing = () => {
      
  let ftpOpts = {
    host: 'tigue.com',
    user: 'tigue',
    password: '43cts21',
    destFilename: '/public_html/chuckscd/index.html'
    };
  	  
  return webFetch('http://cd.chucks85th.com/')
    .then(htmlString => {
      // Process html...
      //console.log(htmlString);
      let mainPage = $.load(htmlString);
      let leftBeerEls = mainPage('#draft_left').find('li').not('.header').map((i, el) => {
        return extractBeerInfo(el);
        });
      let rightBeerEls = mainPage('#draft_right').find('li').not('.header').map((i, el) => {
        return extractBeerInfo(el);
      });
      //console.log('left=' + leftBeerEls.get().length + ' right=' + rightBeerEls.get().length); 
      let beers = leftBeerEls.get().concat(rightBeerEls.get()); 
  
      //console.log('# beers = ' + beers.length);
      //beers.forEach(aBeer => console.log(aBeer));
      let beersAsJson = JSON.stringify(beers);
      return fs.writeFileAsync(fileOpts.beersAsJsonFilename, beersAsJson, "utf8").then(() => {return beers;});
      })
    .then((beers) => {
      // render JS => JSON => HTML via Handlebars
      //console.log(beers.length);
      return fs.readFileAsync(fileOpts.menuTemplateFilename, "utf8")
        .then((menuTemplateString) => {
          let menuTemplate = Handlebars.compile(menuTemplateString);
          menuTemplate(beers).done((menuRenderedString) => {
      	  //console.log(menuRenderedString);
            return fs.writeFileAsync(fileOpts.menuRenderedFilename, menuRenderedString, "utf8").then(() => {return beers;});
            });
          })
        .catch(err => {
  	console.log('handlebars errored: ' + err);
  	throw err;
          });
      })
    .then(() => {
       return gftp
        .connect({host: ftpOpts.host, user: ftpOpts.user, password: ftpOpts.password})
        .then((serverMessage) => {
          return ftp.put(fileOpts.menuRenderedFilename, ftpOpts.destFilename);
          })
        .then(() => {
          console.log('FTP went well seemingly');	  
          return ftp.end();
          });
      })
    .catch(function (err) {
      console.log('webFetch():' + err);
      throw err;
      });
  };  

  
exports.freshenMenu = function(event, context, callback) {
  doYourThing().then(() => {
    console.log('done');
    callback();
    });
  };

exports.freshenMenu( {}, {}, () => console.log('done mimicking Lambad invoke'));  
})();
