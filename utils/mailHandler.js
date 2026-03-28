let nodemailer = require('nodemailer');

let transporter = nodemailer.createTransport({
    host: 'sandbox.smtp.mailtrap.io',
    port: 2525,
    auth: {
        user: 'b0d2004f0b9b7f',
        pass: 'c506892b19b544'
    }
});

module.exports = {
    sendPasswordEmail: async function (toEmail, username, password) {
        let mailOptions = {
            from: '"Admin NNPTUD" <your_email@gmail.com>',
            to: toEmail,
            subject: 'Tài khoản của bạn đã được tạo',
            html: `
                <h2>Xin chào <b>${username}</b>,</h2>
                <p>Tài khoản của bạn đã được tạo thành công trên hệ thống.</p>
                <p>Thông tin đăng nhập:</p>
                <ul>
                    <li><b>Tên đăng nhập:</b> ${username}</li>
                    <li><b>Mật khẩu:</b> ${password}</li>
                </ul>
                <p>Vui lòng đổi mật khẩu sau khi đăng nhập lần đầu.</p>
                <p>Trân trọng,<br/>Admin NNPTUD</p>
            `
        };
        await transporter.sendMail(mailOptions);
    }
};
