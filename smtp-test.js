const nodemailer = require('nodemailer');
const fs = require('fs');

const t = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: 'zikas1208h@gmail.com', pass: 'nlsmliosszpftqau' },
  tls: { rejectUnauthorized: false }
});

t.verify(function(e, s) {
  if (e) {
    fs.writeFileSync('smtp-result.txt', 'FAIL: ' + e.message);
    console.log('FAIL:', e.message);
  } else {
    fs.writeFileSync('smtp-result.txt', 'OK');
    console.log('SMTP OK');
    // Try sending an actual email
    t.sendMail({
      from: '"HNU Portal" <zikas1208h@gmail.com>',
      to: 'backup1208h@gmail.com',
      subject: 'SMTP Test',
      text: 'Test OTP: 123456'
    }, function(err, info) {
      if (err) fs.appendFileSync('smtp-result.txt', '\nSEND FAIL: ' + err.message);
      else fs.appendFileSync('smtp-result.txt', '\nSENT OK: ' + info.messageId);
      process.exit(0);
    });
  }
});

setTimeout(() => { fs.writeFileSync('smtp-result.txt', 'TIMEOUT - no response from Gmail'); process.exit(2); }, 20000);

