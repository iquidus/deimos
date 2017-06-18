'use strict';

var config = require('./lib/config');
var Web3 = require('web3');
var nanotimer = require('nanotimer');
var ProgressBar = require('progress');
var wget = require('wget-improved');
var fs = require('fs');
var jsonfile = require('jsonfile');
var exec = require('child_process').exec;
var request = require('request');
var compareVersions = require('compare-versions');

var web3 = new Web3(new Web3.providers.HttpProvider(
  'http://' + config.web3.host + ':' + config.web3.port
));

var web3Timer = new nanotimer();
var updateTimer = new nanotimer();
var downloadInProgress = false;
var restartRequired = false;

checkDemon();

if (config.autoUpdate === true) {
  if (fs.existsSync('./binaries/gubiq')) {
    log('Checking for Gubiq update..')
    getBinInfo(function(binInfo) {
      exec('./binaries/gubiq version', function(err, stdout, stderr) {
        var version = stdout.split('\n')[1].split(': ')[1].split('-')[0];
        if (compareVersions(version, binInfo.version) === 0) {
          log('Gubiq is already latest version.');
        } else {
          log('A new version of Gubiq is available: ' + binInfo.version);
          downloadClient(binInfo);
        }
      });
    });
  }
}



function exit() {
  process.exit(0);
}

function log(str) {
  if (config.verbose === true)
    console.log(str);
}

function getBinInfo(cb) {
  request.get('https://raw.githubusercontent.com/iquidus/deimos/master/clientBinaries.json', {
    json: true,
  }, function (err, res, remoteVersion) {
    if (remoteVersion.version) {
      return cb(remoteVersion);
    } else {
      log('Unable to fetch latest version info. Using local clientBinaries.json instead.')
      jsonfile.readFile('./clientBinaries.json', function(err, localVersion) {
        if (err)
          log(err)
        return cb(localVersion);
      });
    }
  });
}

function checkDemon() {
  if (restartRequired) {
    log('restart required.');
    restartRequired = false;
  } else {
    if (web3.isConnected() != true) {
      log('Gubiq not responding. Attempting to restart..');
      if (fs.existsSync('./binaries/gubiq')) {
        var cmd = 'screen -dmS gubiq ./binaries/gubiq --rpc --rpcaddr "127.0.0.1" --rpcport "8588" --rpcapi "eth,net,web3"';
        exec(cmd, function(error, stdout, stderr) {
          log('Starting Gubiq..');
          web3Timer.setInterval(checkDemon,'', '10s');
          return;
        });
      } else {
        log('ERROR: binary not found.');
        web3Timer.clearInterval();
        if (downloadInProgress === false) {
          getBinInfo(function(binInfo) {
            downloadClient(binInfo);
          });
        } else {
          return;
        }
      }
    } else {
      return;
    }
  }
}

function downloadClient(binInfo) {
  var count = 0;
  var bar = new ProgressBar(':bar', { total: 100 , width:80});

  var download = wget.download(binInfo.url, './binaries/gubiq-' + binInfo.version, {});
  download.on('error', function(err) {
    log(err);
    exit();
  });

  download.on('start', function(fileSize) {
    log('Downloading Gubiq ' + binInfo.version + ' (%s MB)', ((fileSize/1024)/1024).toFixed(2));
    downloadInProgress = true;
  });

  download.on('end', function(output) {
    downloadInProgress = false;
    log('Download complete. Performing sanity check..\n');
    exec('md5sum ./binaries/gubiq-' + binInfo.version, function(err, stdout, stderr) {
      var md5sum = stdout.split(' ')[0];
      if (md5sum != binInfo.md5) {
        log('checksum: fail');
        log('aborting..');
        exit();
      } else {
        log('checksum: pass');
        exec('chmod +x ./binaries/gubiq-' + binInfo.version, function(error, stdout, stderr) {
          exec('./binaries/gubiq-' + binInfo.version + ' version', function(err, stdout, stderr) {
            var version = stdout.split('\n');
            if (version[0] === binInfo.sanity[0] && version[1] === binInfo.sanity[1]) {
              log('version : pass');
              // copy binary to default.
              exec('cd ./binaries && ln -s ./gubiq-' + binInfo.version +' ./gubiq', function(error, stdout, stderr) {
                restartRequired = true;
                // restart web3 timer.
                web3Timer.setInterval(checkDemon,'', '10s');
              });
            } else {
              log('version : fail');
              log('aborting..');
              exit();
            }
          });
        });
      }
    });
  });

  download.on('progress', function(progress) {
    if (progress * 100 > count && progress * 100 < 100) {
      count++;
      bar.tick();
    }
  });
}
