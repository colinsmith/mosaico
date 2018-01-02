"use strict";
/* global global: false */
var console = require("console");
var ko = require("knockout");
var $ = require("jquery");
var JSZip = require("jszip");
var FileSaver = require('filesaver');

var lsLoader = function(hash_key, emailProcessorBackend) {
  var mdStr = global.localStorage.getItem("metadata-" + hash_key);
  if (mdStr !== null) {
    var model;
    var td = global.localStorage.getItem("template-" + hash_key);
    if (td !== null) model = JSON.parse(td);
    var md = JSON.parse(mdStr);
    return {
      metadata: md,
      model: model,
      extension: lsCommandPluginFactory(md, emailProcessorBackend)
    };
  } else {
    throw "Cannot find stored data for " + hash_key;
  }
};

var lsCommandPluginFactory = function(md, emailProcessorBackend) {
  var commandsPlugin = function(mdkey, mdname, viewModel) {

    // console.log("loading from metadata", md, model);
    var saveCmd = {
      name: 'Save', // l10n happens in the template
      enabled: ko.observable(true)
    };
    saveCmd.execute = function() {
      saveCmd.enabled(false);
      viewModel.metadata.changed = Date.now();
      if (typeof viewModel.metadata.key == 'undefined') {
        console.warn("Unable to find key in metadata object...", viewModel.metadata);
        viewModel.metadata.key = mdkey;
      }
      global.localStorage.setItem("metadata-" + mdkey, viewModel.exportMetadata());
      global.localStorage.setItem("template-" + mdkey, viewModel.exportJSON());
      saveCmd.enabled(true);
    };
    var testCmd = {
      name: 'Test', // l10n happens in the template
      enabled: ko.observable(true)
    };
    var downloadCmd = {
      name: 'Download', // l10n happens in the template
      enabled: ko.observable(true)
    };
    testCmd.execute = function() {
      testCmd.enabled(false);
      var email = global.localStorage.getItem("testemail");
      if (email === null || email == 'null') email = viewModel.t('Insert here the recipient email address');
      email = global.prompt(viewModel.t("Test email address"), email);
      if (email.match(/@/)) {
        global.localStorage.setItem("testemail", email);
        console.log("TODO testing...", email);
        var postUrl = emailProcessorBackend ? emailProcessorBackend : '/dl/';
        var post = $.post(postUrl, {
          action: 'email',
          rcpt: email,
          subject: "[test] " + mdkey + " - " + mdname,
          html: viewModel.exportHTML()
        }, null, 'html');
        post.fail(function() {
          console.log("fail", arguments);
          viewModel.notifier.error(viewModel.t('Unexpected error talking to server: contact us!'));
        });
        post.success(function() {
          console.log("success", arguments);
          viewModel.notifier.success(viewModel.t("Test email sent..."));
        });
        post.always(function() {
          testCmd.enabled(true);
        });
      } else {
        global.alert(viewModel.t('Invalid email address'));
        testCmd.enabled(true);
      }
    };

    /* jshint ignore:start */
    function fetchImage(url) {
      return new Promise((resolve, reject) => {
        var oReq = new XMLHttpRequest();

        oReq.open( "GET", url );
        oReq.responseType = "arraybuffer";
        oReq.send();

        oReq.onload = function(e) {
          if (oReq.status == 200) {

            var imgExt = url.match('\.(gif|jpg|jpeg|tiff|png)');

            var originalFileNameMatches = url.match('(uploads)(.*)\.(gif|jpg|jpeg|tiff|png)');
            var originalFileName = originalFileNameMatches[0];
            originalFileName = originalFileName.replace('uploads%2F', '').replace(' ', '-');

            resolve({
              fetchUrl: url,
              fileExtension: imgExt[0],
              uploadedFileName: originalFileName,
              data: oReq.response
            });

          } else {
            reject(Error(oReq.statusText));
          }
        }
      })
    }

    function htmlEscape(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // I needed the opposite function today, so adding here too:
    function htmlUnescape(str){
        return str
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }

    /* jshint ignore:end */
    
    downloadCmd.execute = function() {
      downloadCmd.enabled(false);
      viewModel.notifier.info(viewModel.t("Downloading..."));
      viewModel.exportHTMLtoTextarea('#downloadHtmlTextarea');
      
      var postUrl = emailProcessorBackend ? emailProcessorBackend : '/dl/';
      global.document.getElementById('downloadForm').setAttribute("action", postUrl);
      // global.document.getElementById('downloadForm').submit();

      // CREATE A PAYLOAD FOR DOWNLOAD
      
      // Create archive (empty)
      var zip = new JSZip();

      // Create dummy DOM element
      var el = global.document.createElement('html');

      // Get the email template document
      var htmlContent = global.document.getElementById('downloadHtmlTextarea').value;

      // If the content actually exists, continue
      if(htmlContent !== null) {

        var img = zip.folder("images");

        // Set the email to the dummy DOM element (for parsing)
        el.innerHTML = htmlContent;

        // Get all image elements
        var images = el.getElementsByTagName('img');

        var resolvedPromisesArray = [];
        var fetchedImages = [];

        // Loop over each image
        for(var i = 0; i < images.length; i++) {

          var imgExt = images[i].src.match('\.(gif|jpg|jpeg|tiff|png)');
          var isUploadedPhoto = (new RegExp('src=([^&]*)')).test(images[i].src);

          if(imgExt !== null && isUploadedPhoto !== false) {

            /* jshint ignore:start */
            resolvedPromisesArray.push(
              fetchImage(images[i].src).then( function(response) {

                fetchedImages.push({
                  fileExtension: response.fileExtension,
                  fileName: response.uploadedFileName,
                  rawUrl: response.fetchUrl,
                  data: response.data
                });

              })
            );
            /* jshint ignore:end */
          }
        }

        // Generate the .zip
        /* jshint ignore:start */

        Promise.all(resolvedPromisesArray).then(values => {

          for(var i = 0; i < fetchedImages.length; i++) {
            var resource = fetchedImages[i];
            var fileName = i + resource.fileExtension;

            if(resource.fileName !== '') {
              img.file(resource.fileName, resource.data, { base64: true });
            } else {
              img.file(fileName, resource.data, { base64: true });
            }

            htmlContent = htmlContent.replace(htmlEscape(resource.rawUrl), ('images/' + resource.fileName));
          }
          
          zip.file("index.html", htmlContent);

          zip.generateAsync({type:'base64'}).then(function (base64) {
              global.window.location.href="data:application/zip;base64," + base64;
          })
        });
        /* jshint ignore:end */

      }

      // console.log(global.document.getElementById('downloadForm'));

      downloadCmd.enabled(true);
    };

    viewModel.save = saveCmd;
    viewModel.test = testCmd;
    viewModel.download = downloadCmd;
  }.bind(undefined, md.key, md.name);

  return commandsPlugin;
};

module.exports = lsLoader;
