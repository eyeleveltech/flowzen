require('dotenv').config({ path: '../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const nodemailer = require('nodemailer');

async function resendVerification() {
  const email = 'harish.s@eyelevelstudio.in';
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    console.log('User not found!');
    return;
  }

  if (user.isEmailVerified) {
    console.log('User is already verified!');
    return;
  }

  console.log(`Found user! Token is: ${user.emailVerifyToken}`);

  // Set up transporter
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpPass },
  });

  const verifyUrl = `http://localhost:3000/verify-email?token=${user.emailVerifyToken}`;

  try {
    await transporter.sendMail({
      from: '"Flowzen" <noreply@flowzen.app>',
      to: email,
      subject: 'Verify your email address - Flowzen (RESEND)',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome to Flowzen!</h2>
          <p>Please verify your email address by clicking the link below:</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">If you did not create this account, please ignore this email.</p>
        </div>
      `,
    });
    console.log('✅ Resent verification email successfully to', email);
  } catch (err) {
    console.error('❌ Failed to send:', err);
  } finally {
    await prisma.$disconnect();
  }
}

resendVerification();
