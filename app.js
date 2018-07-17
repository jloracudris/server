var express = require('express');
var smart_api = require('smart-api-js');
var trim = require('lodash.trim');
var StellarSdk = require('stellar-sdk');
var app = express();
var bodyParser = require('body-parser');
var axios = require('axios');

var keypair = null;
var transactionReportPhone = null;

var conf = {
    master_key:         'GA25BIHT3PV2BFVGE7O63S5RT675FPZ7N3CR2KSBI5GDRD5YTDWZDRK3',
    horizon_host:       trim("http://blockchain.pexto.tk", '/'),
    api_url:            'http://api.pexto.tk',
    project_name:       'PEXTO',
};

conf.SmartApi = new smart_api({
    host: 'http://api.pexto.tk'
});

conf.horizon = new StellarSdk.Server(conf.horizon_host);
conf.phoneDataURL = 'http://api.pexto.tk/wallets/getdata';

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

simpleLogin = function (login, password) {
  var wallet_data = null;
  const self = this;

  return conf.SmartApi.Wallets.get({
          username: login,
          password: password,
      })
      .then(function (wallet) {
          wallet_data = wallet;
          self.keypair = StellarSdk.Keypair.fromSeed(wallet_data.getKeychainData());
      }).catch((error) => {
        res.status(500).send(`Wallet not found for ${login}`)              
      });
},

processPayment = function (accountId, memoText, amount, asset, fromAccountId, res) { 
    const self = this;
    return conf.horizon.loadAccount(fromAccountId)
    // TODO: Do not add memo to tx if it's empty
        .then(function (source) {
            var memo = StellarSdk.Memo.text(memoText);
            var tx = new StellarSdk.TransactionBuilder(source, {memo: memo})
                .addOperation(StellarSdk.Operation.payment({
                    destination: accountId,
                    amount: amount.toString(),
                    asset: new StellarSdk.Asset(asset, conf.master_key)
                }))
                .build();

            tx.sign(self.keypair);

            return conf.horizon.submitTransaction(tx);
        })
        .then(function () {                    
          res.send('Transfer Succesful');
        })
        .catch(function (err) {            
          res.status(500).send('The transfer could not be performed');
        })
}

getPhoneData = function(FromphoneNum, TophoneNum, amount, res) {    
    const self = this;
    simpleLogin(FromphoneNum, "Ab" + FromphoneNum)
        .then(function (data) {              
            conf.SmartApi.Wallets.getWalletData({
                    phone : FromphoneNum
                })
                .then(function (FromwalletData) {                  
                    conf.SmartApi.Wallets.getWalletData({
                            phone : TophoneNum
                        })
                        .then(function (TowalletData) {
                            if (FromwalletData && FromwalletData.data.accountId) {
                                if (TowalletData && TowalletData.data.accountId) {
                                  self.processPayment(TowalletData.data.accountId, 'by_phone', amount, 'PXT', FromwalletData.data.accountId, res);
                                }
                            }
                            
                        })
                        .catch(function (err) {
                            res.send(err);                             
                    });
                })
                .catch(function (err) {
                  res.status(500).send(`To Phone wallet not found ${TophoneNum}`)
                    //return m.flashError(Conf.tr("User not found! Check phone number"));
                });
        })
        .catch(err => {                            
          res.status(500).send(`From Phone wallet not found ${FromphoneNum}`)     
        })
}

getAccountIdData = (accountId, res) => {
    conf.horizon.payments()
        .forAccount(accountId)
        .order('desc')
        .limit(100)
        .call()
        .then(function (result) {
            console.log(result.records.length);                
            mapDatasourceTransactionReport(result.records, false, res);            
        })
        .catch(err => {
            res.status(500).send(`No data have been found`)               
        });
}

getReportPhoneData = (phone, res) => {
    const self = this;
    transactionReportPhone = phone;    
    simpleLogin(phone, "Ab" + phone)
        .then(function (data) {              
            axios.post(conf.phoneDataURL, {
                phone: phone
            }).then(function(phoneinfo) {
                getAccountIdData(phoneinfo.data.data.accountId, res);  
            }).catch(function(error) {        
                res.status(500).send(`No data have been found with the number ${phone}`)
            });
        })
        .catch(err => {                            
          res.status(500).send(`From Phone wallet not found ${FromphoneNum}`)     
        })
}

getTypeTransactions = function (phone, accountId) {
    var settlementAccount = conf.settlementAccount;
    console.log(phone)
    console.log(transactionReportPhone)
    if (phone === transactionReportPhone){
        return {
                class: 'mdc-theme--primary',
                type: "Deposit"
            }
    }

    if (accountId === settlementAccount) {
         return {
                class: 'mdc-theme--secondary',
                type: "Withdraw"
            }
    }
    return {
                class: 'mdc-theme--secondary',
                type: "Transfered"
            }
}

mapDatasourceTransactionReport = function(ds, concat, res) {            
    var result = [];
    var maxLenght = ds.length;            
    var countExcluded = 0;
    for(let i = 0; i < ds.length; i++ ) {
        var accountId = ds[i].to == this.keypair ? ds[i].from : ds[i].to;        
         axios.post(conf.phoneDataURL, {
            accountId: accountId
        }).then(function(phoneinfo) {                        
            var transaction = {
                closed_at: ds[i].closed_at,
                asset_code: ds[i].asset_code,
                to: ds[i].to,
                phoneNumber: phoneinfo.data.data.phone,
                amount: ds[i].amount,
                id: ds[i].id,
                type: getTypeTransactions(phoneinfo.data.data.phone, ds[i].to),
                feeValue: ds[i].fee.amount_changed  ? Math.round(Number(ds[i].fee.amount_changed) * 100) / 100 : -1
            }                    
            result.push(transaction)                        
            if (result.length === ds.length - countExcluded) {
                const rs = result.sort(function(a, b) {
                    return new Date(b.closed_at) - new Date(a.closed_at);
                });                       
                res.send(rs);
            }
        }).catch(function(error) {
                var transaction = {
                    closed_at: ds[i].closed_at,
                    asset_code: ds[i].asset_code,
                    to: ds[i].to,
                    phoneNumber: '',
                    amount: ds[i].amount,
                    id: ds[i].id,
                    type: getTypeTransactions('', ds[i].to),
                    feeValue: ds[i].fee.amount_changed  ? Math.round(Number(ds[i].fee.amount_changed) * 100) / 100 : -1
                }                    
                result.push(transaction)                        
                if (result.length === ds.length - countExcluded) {
                    const rs = result.sort(function(a, b) {
                        return new Date(b.closed_at) - new Date(a.closed_at);
                    });                       
                    res.send(rs);
                }
        });
    }            
}

app.post('/transfer', function (req, res) {  
  const from = req.body.from;
  const to = req.body.to;
  const amount = req.body.amount;
  getPhoneData(from, to, amount, res);  
});

app.get('/transactions/:phone', function (req, res) {  
    const phone = req.params.phone;    
    getReportPhoneData(phone, res);
});

app.listen(process.env.PORT || 5000, function () {
  console.log('Example app listening on port 5000!');
});

