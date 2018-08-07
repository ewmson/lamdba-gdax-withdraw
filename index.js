const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'});
const apiURI = 'https://api.pro.coinbase.com';
const sell_amount = '50.17';
const Gdax = require('gdax');


function truncateDecimals(num, digits) {
    const numS = num.toString(),
        decPos = numS.indexOf('.'),
        substrLength = decPos === -1 ? numS.length : 1 + decPos + digits,
        trimmedResult = numS.substr(0, substrLength),
        finalResult = isNaN(trimmedResult) ? 0 : trimmedResult;

    return parseFloat(finalResult);
}

const encrypted_secret = process.env['api_secret'];
const encrypted_key = process.env['api_key'];
const encrypted_passphrase = process.env['passphrase'];
const encrypted_account_id = process.env['account_id'];


let key;
let secret;
let passphrase;
let account_id;

function getFunds(gdax_client, account_id) {
    return gdax_client.getAccount(account_id).then(response => response.available);
}

function processEvent(event, context, callback) {
    console.log('starting to process the event');
    const authedClient = new Gdax.AuthenticatedClient(
        key,
        secret,
        passphrase,
        apiURI
    );
    const sellParams = {
        type: 'market',
        funds: sell_amount, // usd
        product_id: 'BTC-USD',
    };
    /*authedClient.getAccounts().then(result => {
        for (let account of result){
            console.log('a account =', account)
        }
    })*/
    return authedClient.getPaymentMethods().then(methods => {
        return methods[1].id;
    }).then(method => {
        console.log('got payment method id = ', method);
        return authedClient.sell(sellParams).then(response => {
            console.log('sell successful', response);
        }).catch(err => {
            console.log('err sell = ', err);
            return callback(err);
        }).then(() => {
            return getFunds(authedClient, account_id).then(funds_to_withdraw => {
                console.log('funds available =', funds_to_withdraw);
                const withdrawPaymentParamsUSD = {
                    amount: truncateDecimals(funds_to_withdraw, 2),
                    currency: 'USD',
                    payment_method_id: method, // ach_bank_account
                };
                return withdrawPayment(authedClient, withdrawPaymentParamsUSD).then(response => {
                    console.log('response =', response);
                    return response;
                }).catch(err => {
                    console.log('error withdraw =', err);
                    return callback(err);
                });
            });

        })
    });

}

function decryptKMS(key) {
    return new Promise((resolve, reject) => {
        const kms = new AWS.KMS();

        kms.decrypt({CiphertextBlob: new Buffer(key, 'base64')}, (err, data) => {
            if (err) {
                reject(err)
            }
            else {
                resolve(data.Plaintext.toString('ascii'))
            }
        })
    })
}

exports.handler = (event, context, callback) => {
    if (key) {
        return processEvent(event, context, callback);
    } else {
        // Decrypt code should run once and variables stored outside of the function
        // handler so that these are decrypted once per container
        const keys = [encrypted_key, encrypted_secret, encrypted_passphrase, encrypted_account_id];

        return Promise.all(keys.map(decryptKMS))
            .then(([d_key, d_secret, d_passphrase, d_account_id]) => {
                key = d_key;
                secret = d_secret;
                passphrase = d_passphrase;
                account_id = d_account_id;
                return processEvent(event, context, callback);
            })
            .catch((err) => {
                console.log('err decrypt =', err);
                return callback(err)
            });
    }
};

function withdrawPayment(gdax_client, params, callback) {
    gdax_client._requireParams(params, ['amount', 'currency', 'payment_method_id']);
    return gdax_client.post(['withdrawals/payment-method'], {body: params}, callback);
}
