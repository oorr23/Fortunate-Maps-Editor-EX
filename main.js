var http = require('http');
var FormData = require('form-data');
var fs = require('fs');
var path = require('path');
var express = require('express');

var app = express();
var PORT = process.env.PORT || 8060;

app.use(express.static(path.join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

function toBuffer(data, encoding) {
  if (Buffer.from) {
    return encoding ? Buffer.from(data, encoding) : Buffer.from(data);
  }
  return encoding ? new Buffer(data, encoding) : new Buffer(data);
}

app.post('/test', function(req, res) {
    var logic = JSON.parse(req.body.logic);
    var layout = toBuffer(req.body.layout, 'base64');

    var url;
    if (req.body.eu == 'true')
      url =  Math.random() < 0.5 ? 'http://maptest.newcompte.fr/testmap' : 'http://justletme.be:8080/testmap';
    else
      url = 'http://tagpro-maptest.koalabeast.com/testmap';

    var form = new FormData();

    fs.writeFileSync('temp.json', toBuffer(JSON.stringify(logic)));
    fs.writeFileSync('temp.png', layout);
    form.append('logic', fs.createReadStream('temp.json'));
    form.append('layout', fs.createReadStream('temp.png'));

    form.submit(url, function(err, testRes) {
      if (err) {
        res.send('Sorry, we could not start up a test map. ' + err.toString());
      } else {
        testRes.resume();
        res.send(testRes.headers);
      }
    });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('TagPro Map Editor running at http://localhost:' + PORT);
  console.log('On your phone, use this computer LAN IP on port ' + PORT);
});
