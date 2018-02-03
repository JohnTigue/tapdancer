/* Want to have a different set of values per stage.
   So severless.yml sets env of stage and this here decides based 
   on process.ENV.stage which one of these to export
 */

if(process.ENV.stage === "production") {
  const prodDestBucketName = "chuckstaplist.com";

  const productionConfiguration = {
    s3BucketPublishDest: prodDestBucketName,
    fileOpts: {
      menuTemplateFilename: "templates/menu2html.hbs",
      menuRenderedFilename: "/tmp/index.html",
      menuRenderedPutToS3: "s3://" + prodDestBucketName + "/index.html", // The main artifact output URL i.e. where what was made goes when done
      beersAsJsonFilename: "/tmp/beers.json",
      beersAsJsonInS3: "s3://" + prodDestBucketName + "/beers.json"
    }
  };
  module.exports.configuration = productionConfiguration;
} else if(process.ENV.stage === "develop") {
  const devDestBucketName = "chuckstaplist.dev";

  const developConfiguration = {
    s3BucketPublishDest: devDestBucketName,
    fileOpts: {
      menuTemplateFilename: "templates/menu2html.hbs",
      menuRenderedFilename: "/tmp/index.html",
      menuRenderedPutToS3: "s3://" + devDestBucketName + "/index.html", 
      beersAsJsonFilename: "/tmp/beers.json",
      beersAsJsonInS3: "s3://" + devDestBucketName + "/beers.json"
    }
  };
  module.exports.configuration = developmentConfiguration;
} else {
  throw new Error("configuration.js: process.ENV.stage not set as expected.");
}
  
