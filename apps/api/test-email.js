require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.error('❌ EMAIL_USER or EMAIL_PASS is missing in .env file!');
    return;
  }

  console.log(`Testing SMTP connection for: ${user}`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  try {
    // Verify the connection configuration
    await transporter.verify();
    console.log('✅ Server is ready to take our messages. Connection successful!');
    
    // Try sending a test email to the same address
    const info = await transporter.sendMail({
      from: user,
      to: user,
      subject: 'Test Email from Flowzen',
      text: 'If you see this, your SMTP configuration is perfect!',
    });
    
    console.log(`✅ Test email successfully sent! Message ID: ${info.messageId}`);
  } catch (error) {
    console.error('❌ Failed to connect or send email. See detailed error below:');
    console.error(error);
  }
}

testEmail();
