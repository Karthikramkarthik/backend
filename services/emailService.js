const tls = require('tls');
const path = require('path');
const db = require('../config/database');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Custom TLS SMTP Sender
function sendEmailViaTLS({ host, port, user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    console.log(`[SMTP] Connecting to ${host}:${port}...`);
    
    const socket = tls.connect(port, host, { rejectUnauthorized: true }, () => {
      console.log('[SMTP] TLS connection established.');
    });

    let step = 0;
    const send = (data) => {
      socket.write(data + '\r\n');
    };

    let buffer = '';
    let timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP Connection Timeout (15s)'));
    }, 15000);

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop();

      for (const line of lines) {
        console.log(`[SMTP] Server: ${line}`);
        
        // Error response handling
        if (line.startsWith('5') || line.startsWith('4')) {
          clearTimeout(timeout);
          socket.destroy();
          return reject(new Error(`SMTP Error: ${line}`));
        }

        // SMTP State Machine
        if (line.startsWith('220') && step === 0) {
          send('EHLO localhost');
          step = 1;
        } else if (line.startsWith('250') && step === 1) {
          // Multiline responses end with '250 '
          if (line.startsWith('250 ')) {
            send('AUTH LOGIN');
            step = 2;
          }
        } else if (line.startsWith('334') && step === 2) {
          send(Buffer.from(user).toString('base64'));
          step = 3;
        } else if (line.startsWith('334') && step === 3) {
          send(Buffer.from(pass).toString('base64'));
          step = 4;
        } else if (line.startsWith('235') && step === 4) {
          send(`MAIL FROM:<${user}>`);
          step = 5;
        } else if (line.startsWith('250') && step === 5) {
          send(`RCPT TO:<${to}>`);
          step = 6;
        } else if (line.startsWith('250') && step === 6) {
          send('DATA');
          step = 7;
        } else if (line.startsWith('354') && step === 7) {
          const headers = [
            `From: ${user}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            html,
            '.'
          ].join('\r\n');
          send(headers);
          step = 8;
        } else if (line.startsWith('250') && step === 8) {
          send('QUIT');
          step = 9;
          clearTimeout(timeout);
          resolve({ success: true });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Persists and attempts to send a notification email.
 * Prevents duplicate emails for the same invoice using DB constraints.
 */
async function sendOrQueueEmail({ recipient, subject, html, orderNumber, invoiceNumber }) {
  // Check SMTP details are available
  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    const errMsg = 'SMTP credentials not configured in environment variables.';
    console.error(`[EmailService] ${errMsg}`);
    
    // Log as Failed immediately due to config error
    try {
      await db.query(
        `INSERT INTO email_logs (recipient, subject, body, status, error_message, attempts, order_number, invoice_number) 
         VALUES (?, ?, ?, 'Failed', ?, 1, ?, ?)`,
        [recipient, subject, html, errMsg, orderNumber, invoiceNumber]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') {
        console.log(`[EmailService] Duplicate notification blocked for invoice ${invoiceNumber}`);
      } else {
        console.error('[EmailService] Failed to log failed email:', dbErr.message);
      }
    }
    return { success: false, error: errMsg };
  }

  // 1. Log in DB as 'Pending Retry' to start
  let emailLogId = null;
  try {
    const [result] = await db.query(
      `INSERT INTO email_logs (recipient, subject, body, status, attempts, order_number, invoice_number) 
       VALUES (?, ?, ?, 'Pending Retry', 1, ?, ?)`,
      [recipient, subject, html, orderNumber, invoiceNumber]
    );
    emailLogId = result.insertId;
  } catch (dbErr) {
    if (dbErr.code === 'ER_DUP_ENTRY') {
      console.log(`[EmailService] Duplicate email prevention: Email already sent or logged for invoice ${invoiceNumber} to ${recipient}.`);
      return { success: false, duplicate: true };
    }
    console.error('[EmailService] Error inserting email log:', dbErr.message);
    throw dbErr;
  }

  // 2. Attempt SMTP transmission
  try {
    await sendEmailViaTLS({ host, port, user, pass, to: recipient, subject, html });
    
    // Update status to Sent
    await db.query(
      "UPDATE email_logs SET status = 'Sent', error_message = NULL WHERE id = ?",
      [emailLogId]
    );
    console.log(`[EmailService] Email successfully sent to ${recipient} for invoice ${invoiceNumber}`);
    return { success: true };
  } catch (smtpErr) {
    console.error(`[EmailService] SMTP transmission failed for invoice ${invoiceNumber}:`, smtpErr.message);
    
    // Keep status as Pending Retry, record error message
    await db.query(
      "UPDATE email_logs SET error_message = ? WHERE id = ?",
      [smtpErr.message, emailLogId]
    );
    return { success: false, error: smtpErr.message };
  }
}

/**
 * Retries sending emails that are marked as 'Pending Retry' and have < 3 attempts.
 */
async function retryPendingEmails() {
  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.log('[EmailService Scheduler] Skip retry: SMTP credentials missing.');
    return;
  }

  try {
    const [rows] = await db.query(
      "SELECT id, recipient, subject, body, attempts, invoice_number FROM email_logs WHERE status = 'Pending Retry' AND attempts < 3"
    );

    if (rows.length === 0) {
      return;
    }

    console.log(`[EmailService Scheduler] Found ${rows.length} pending emails to retry...`);

    for (const email of rows) {
      const newAttempts = email.attempts + 1;
      try {
        await sendEmailViaTLS({ host, port, user, pass, to: email.recipient, subject: email.subject, html: email.body });
        
        // Successful retry
        await db.query(
          "UPDATE email_logs SET status = 'Sent', attempts = ?, error_message = NULL WHERE id = ?",
          [newAttempts, email.id]
        );
        console.log(`[EmailService Scheduler] Successfully retried & sent email ${email.id} (Attempt ${newAttempts})`);
      } catch (smtpErr) {
        console.error(`[EmailService Scheduler] Retry ${newAttempts} failed for email ${email.id}:`, smtpErr.message);
        
        const nextStatus = newAttempts >= 3 ? 'Failed' : 'Pending Retry';
        await db.query(
          "UPDATE email_logs SET status = ?, attempts = ?, error_message = ? WHERE id = ?",
          [nextStatus, newAttempts, smtpErr.message, email.id]
        );
      }
    }
  } catch (err) {
    console.error('[EmailService Scheduler] Error running retry cycle:', err.message);
  }
}

/**
 * Starts the periodic background cron/timer scheduler for retries.
 */
function startScheduler() {
  console.log('[EmailService] Background retry scheduler initialized.');
  // Run every 5 minutes
  setInterval(retryPendingEmails, 5 * 60 * 1000);
}

/**
 * Asynchronously generates and sends a POS invoice notification email.
 */
async function sendPOSNotification(saleId) {
  try {
    // 1. Fetch Sale details
    const [sales] = await db.query(
      `SELECT s.*, c.name as customer_name, c.mobile as customer_mobile, c.email as customer_email,
              DATE_FORMAT(s.sale_date, '%Y-%m-%d') as formatted_sale_date
       FROM sales s 
       JOIN customers c ON s.customer_id = c.id
       WHERE s.id = ? LIMIT 1`,
      [saleId]
    );

    if (sales.length === 0) {
      console.error(`[EmailService] Sale record ${saleId} not found.`);
      return;
    }

    const sale = sales[0];

    // 2. Fetch Sale Items
    const [items] = await db.query(
      `SELECT si.*, p.name as product_name, p.code as product_code 
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [saleId]
    );

    // 3. Prepare parameters
    const invoiceNumber = sale.invoice_number;
    // For POS sales, generate a client-facing Order Number referencing date & sale ID (e.g. ORD-POS-YYYYMMDD-ID)
    const datePart = sale.formatted_sale_date.replace(/-/g, '');
    const orderNumber = sale.order_number || `ORD-POS-${datePart}-${String(sale.id).padStart(4, '0')}`;
    
    const recipient = process.env.SMTP_NOTIFICATION_RECIPIENT || 'info@chuttipops.in';
    const subject = `New POS Order Completed – Invoice #${invoiceNumber}`;

    // 4. Build elegant HTML receipt
    let itemsHtml = '';
    items.forEach(item => {
      itemsHtml += `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eeeeee;">
            <div style="font-weight: bold; font-size: 0.9em; color: #333333;">${item.product_name}</div>
            <div style="font-size: 0.8em; color: #777777;">SKU: ${item.product_code} ${item.size ? `| Size: ${item.size}` : ''}</div>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: center; color: #555555;">${item.quantity}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right; color: #555555;">₹${parseFloat(item.rate).toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: bold; color: #10B981;">₹${parseFloat(item.total).toFixed(2)}</td>
        </tr>
      `;
    });

    const formatCurrency = (val) => val ? parseFloat(val).toFixed(2) : '0.00';

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Order Receipt</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); border-collapse: collapse;">
          <!-- Header Banner -->
          <tr>
            <td bgcolor="#6366F1" style="padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 1.6em; font-weight: 800; letter-spacing: 0.5px;">CHUTTIPOPS</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 0.9em;">Store POS Sale Notification</p>
            </td>
          </tr>
          
          <!-- Content Body -->
          <tr>
            <td style="padding: 30px;">
              <!-- Intro -->
              <p style="margin-top: 0; color: #4b5563; font-size: 1em; line-height: 1.5;">
                A new POS order has been successfully checked out and completed in the Admin Panel. Details of the transaction are below:
              </p>
              
              <!-- Metadata Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; border-collapse: collapse;">
                <tr bgcolor="#f9fafb">
                  <td style="padding: 12px 15px; border-bottom: 1px solid #e5e7eb; width: 50%;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Order Number</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${orderNumber}</div>
                  </td>
                  <td style="padding: 12px 15px; border-bottom: 1px solid #e5e7eb; width: 50%;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Invoice Number</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${invoiceNumber}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 15px; border-bottom: 1px solid #e5e7eb;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Customer Name</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${sale.customer_name}</div>
                  </td>
                  <td style="padding: 12px 15px; border-bottom: 1px solid #e5e7eb;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Customer Mobile</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${sale.customer_mobile}</div>
                  </td>
                </tr>
                <tr bgcolor="#f9fafb">
                  <td style="padding: 12px 15px;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Payment Method</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${sale.payment_method}</div>
                  </td>
                  <td style="padding: 12px 15px;">
                    <div style="font-size: 0.75em; text-transform: uppercase; color: #9ca3af; font-weight: bold; letter-spacing: 0.5px;">Order Date</div>
                    <div style="font-weight: bold; color: #1f2937; margin-top: 3px;">${sale.formatted_sale_date}</div>
                  </td>
                </tr>
              </table>
              
              <!-- Items Listing Header -->
              <h3 style="margin-top: 30px; margin-bottom: 10px; color: #1f2937; font-weight: bold; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">
                Purchased Products
              </h3>
              
              <!-- Items Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                <thead>
                  <tr bgcolor="#f9fafb">
                    <th align="left" style="padding: 10px; font-weight: bold; color: #4b5563; font-size: 0.85em; border-bottom: 1px solid #e5e7eb;">Product Details</th>
                    <th align="center" style="padding: 10px; font-weight: bold; color: #4b5563; font-size: 0.85em; border-bottom: 1px solid #e5e7eb; width: 60px;">Qty</th>
                    <th align="right" style="padding: 10px; font-weight: bold; color: #4b5563; font-size: 0.85em; border-bottom: 1px solid #e5e7eb; width: 90px;">Rate</th>
                    <th align="right" style="padding: 10px; font-weight: bold; color: #4b5563; font-size: 0.85em; border-bottom: 1px solid #e5e7eb; width: 95px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
              
              <!-- Totals Section -->
              <table align="right" cellpadding="0" cellspacing="0" style="margin-top: 20px; width: 280px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; color: #4b5563; font-size: 0.9em;">Subtotal:</td>
                  <td align="right" style="padding: 6px 0; font-weight: bold; color: #1f2937; font-size: 0.9em;">₹${formatCurrency(sale.subtotal)}</td>
                </tr>
                ${parseFloat(sale.discount) > 0 ? `
                <tr>
                  <td style="padding: 6px 0; color: #ef4444; font-size: 0.9em;">Discount:</td>
                  <td align="right" style="padding: 6px 0; font-weight: bold; color: #ef4444; font-size: 0.9em;">-₹${formatCurrency(sale.discount)}</td>
                </tr>
                ` : ''}
                ${parseFloat(sale.gst_amount) > 0 ? `
                <tr>
                  <td style="padding: 6px 0; color: #4b5563; font-size: 0.9em;">GST / Tax:</td>
                  <td align="right" style="padding: 6px 0; font-weight: bold; color: #1f2937; font-size: 0.9em;">₹${formatCurrency(sale.gst_amount)}</td>
                </tr>
                ` : ''}
                ${parseFloat(sale.shipping_charge) > 0 ? `
                <tr>
                  <td style="padding: 6px 0; color: #4b5563; font-size: 0.9em;">Shipping:</td>
                  <td align="right" style="padding: 6px 0; font-weight: bold; color: #1f2937; font-size: 0.9em;">₹${formatCurrency(sale.shipping_charge)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 10px 0; border-top: 1px solid #e5e7eb; color: #111827; font-weight: 800; font-size: 1.1em;">Grand Total:</td>
                  <td align="right" style="padding: 10px 0; border-top: 1px solid #e5e7eb; color: #10B981; font-weight: 800; font-size: 1.25em;">₹${formatCurrency(sale.grand_total)}</td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer Footer -->
          <tr>
            <td bgcolor="#f9fafb" style="padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 0.75em; color: #9ca3af; line-height: 1.4;">
                This is an automated sales transaction confirmation email. Please do not reply directly to this message.
              </p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // 5. Send or Queue email
    // Recipient can be extended in future to support sending to customer (e.g. sale.customer_email)
    await sendOrQueueEmail({ recipient, subject, html: htmlBody, orderNumber, invoiceNumber });

  } catch (error) {
    console.error(`[EmailService] Failed processing POS receipt notification for sale ${saleId}:`, error.stack);
  }
}

module.exports = {
  sendPOSNotification,
  retryPendingEmails,
  startScheduler
};
