const nodemailer = require("C:/Users/naifb/Desktop/eyelevel intern/project/flowzen/node_modules/nodemailer");

async function run() {
  try {
    console.log("=== SENDING REAL EMAIL VIA GMAIL SERVICE ===");

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: "flowzen2026@gmail.com",
        pass: "rnyalxragcealooo"
      }
    });

    console.log("Sending mail to naifbasha2003@gmail.com...");
    const info = await transporter.sendMail({
      from: '"Flowzen" <flowzen2026@gmail.com>',
      to: "naifbasha2003@gmail.com",
      subject: '[Flowzen] Test Live Email Notification',
      html: `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; border: 1px solid #e5e7eb; border-radius: 12px; margin: auto;">
          <h2 style="color: #111827; margin-bottom: 8px;">Hello Naif,</h2>
          <p style="color: #4b5563; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            This is a real live test notification email sent directly from Flowzen!
          </p>
          <div style="margin-bottom: 30px;">
            <a href="http://localhost:3000/dashboard" style="background: #111827; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; display: inline-block;">Open Flowzen Dashboard</a>
          </div>
        </div>
      `
    });

    console.log("✅ SUCCESS: Email sent successfully!", info.messageId);

  } catch (err) {
    console.error("❌ FAILED to send email via Google SMTP:", err.message);
  }
}

run();
