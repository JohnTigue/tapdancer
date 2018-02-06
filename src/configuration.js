/* Want to have a different set of values per stage.
 * So severless.yml sets env of stage and this here decides based 
 * on process.env.stage which settings configuration to export.
 * 
 * This is setup for two stages: "production" and "develop"
 *
 * Buckets:
 *   production: s3://chuckstaplist.com
 *   develop:    s3://chuckstaplist-dev
 */

// TODO: these two should move to serverless.yml, and then get used here as process.env.devDestBucketName, etc.
const devDestBucketName = "chuckstaplist-dev";
const prodDestBucketName = "chuckstaplist.com";

if(process.env.stage === "production") {
  console.log("Setting configuration for production stage");
  let menuTemplateFileName = "src/templates/menu2html.hbs";
  module.exports.configuration = makeConfiguration(prodDestBucketName, menuTemplateFileName);
} else if(process.env.stage === "develop") {
  console.log("Setting configuration for develop stage");
  let menuTemplateFileName = "src/templates/menu2html.develop.hbs";  
  module.exports.configuration = makeConfiguration(devDestBucketName, menuTemplateFileName);
} else {
  throw new Error("configuration.js: process.env.stage not set as expected. Found: " + process.env.stage);
}

// TODO: no, the template shouldn't change; simply same file, different git branches
function makeConfiguration(aBucketName, aMenuTemplateFileName) {
  return {
    s3BucketPublishDest: aBucketName,
    menuTemplateRelativeFilename: aMenuTemplateFileName,
    menuRendered: {
      localFilename: "/tmp/index.html",
      s3Url: "s3://" + aBucketName + "/index.html"
    },
    beersJson: {
      localFilename: "/tmp/beers.json",
      s3Url: "s3://" + aBucketName + "/beers.json"
    }
  };

}
