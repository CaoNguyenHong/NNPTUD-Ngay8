var express = require("express");
var router = express.Router();
let { uploadImage, uploadExcel } = require('../utils/uploadHandler')
let path = require('path')
let exceljs = require('exceljs')
let categoryModel = require('../schemas/categories')
let productModel = require('../schemas/products')
let inventoryModel = require('../schemas/inventories')
let userModel = require('../schemas/users')
let roleModel = require('../schemas/roles')
let cartModel = require('../schemas/carts')
let mongoose = require('mongoose')
let slugify = require('slugify')
let { sendPasswordEmail } = require('../utils/mailHandler')

function generatePassword() {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const nums  = '0123456789';
    const syms  = '!@#$%^&*';
    const all   = upper + lower + nums + syms;
    let pass = [
        upper[Math.floor(Math.random() * upper.length)],
        lower[Math.floor(Math.random() * lower.length)],
        nums [Math.floor(Math.random() * nums.length)],
        syms [Math.floor(Math.random() * syms.length)],
    ];
    for (let i = 4; i < 16; i++) {
        pass.push(all[Math.floor(Math.random() * all.length)]);
    }
    return pass.sort(() => Math.random() - 0.5).join('');
}

router.get('/:filename', function (req, res, next) {
    let pathFile = path.join(__dirname, '../uploads', req.params.filename)
    res.sendFile(pathFile)
})

router.post('/one_file', uploadImage.single('file'), function (req, res, next) {
    if (!req.file) {
        res.status(404).send({
            message: "file khong duoc de trong"
        })
        return
    }
    res.send({
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size
    })
})
router.post('/multiple_file', uploadImage.array('files'), function (req, res, next) {
    if (!req.files) {
        res.status(404).send({
            message: "file khong duoc de trong"
        })
        return
    }
    res.send(req.files.map(f => {
        return {
            filename: f.filename,
            path: f.path,
            size: f.size
        }
    }))
})
router.post('/excel', uploadExcel.single('file'), async function (req, res, next) {
    //workbook->worksheet->row/column->cell
    let workbook = new exceljs.Workbook();
    let pathFile = path.join(__dirname, '../uploads', req.file.filename)
    await workbook.xlsx.readFile(pathFile);
    let worksheet = workbook.worksheets[0];
    let categories = await categoryModel.find({});
    let categoryMap = new Map()
    for (const category of categories) {
        categoryMap.set(category.name, category._id)
    }
    let products = await productModel.find({});
    let getTitle = products.map(p => p.title)
    let getSku = products.map(p => p.sku)
    let result = [];
    for (let row = 2; row <= worksheet.rowCount; row++) {
        let errorsInRow = [];
        const contentRow = worksheet.getRow(row);
        let sku = contentRow.getCell(1).value;
        let title = contentRow.getCell(2).value;
        let category = contentRow.getCell(3).value;
        let price = Number.parseInt(contentRow.getCell(4).value);
        let stock = Number.parseInt(contentRow.getCell(5).value);
        if (price < 0 || isNaN(price)) {
            errorsInRow.push("price pahi la so duong")
        }
        if (stock < 0 || isNaN(stock)) {
            errorsInRow.push("stock pahi la so duong")
        }
        if (!categoryMap.has(category)) {
            errorsInRow.push("category khong hop le")
        }
        if (getTitle.includes(title)) {
            errorsInRow.push("Title da ton tai")
        }
        if (getSku.includes(sku)) {
            errorsInRow.push("sku da ton tai")
        }
        if (errorsInRow.length > 0) {
            result.push(errorsInRow)
            continue;
        }
        let session = await mongoose.startSession();
        session.startTransaction()
        try {
            let newProduct = new productModel({
                sku: sku,
                title: title,
                slug: slugify(title,
                    {
                        replacement: '-',
                        remove: undefined,
                        lower: true,
                        trim: true
                    }
                ), price: price,
                description: title,
                category: categoryMap.get(category)
            })
            await newProduct.save({ session });

            let newInventory = new inventoryModel({
                product: newProduct._id,
                stock: stock
            })
            await newInventory.save({ session });
            await newInventory.populate('product')
            await session.commitTransaction()
            await session.endSession()
            getTitle.push(newProduct.title)
            getSku.push(newProduct.sku)
            result.push(newInventory)
        } catch (error) {
            await session.abortTransaction()
            await session.endSession()
            res.push(error.message)
        }

    }
    res.send(result)
})

router.post('/users_excel', uploadExcel.single('file'), async function (req, res, next) {
    if (!req.file) {
        res.status(400).send({ message: "file khong duoc de trong" })
        return
    }

    let workbook = new exceljs.Workbook();
    let pathFile = path.join(__dirname, '../uploads', req.file.filename)
    await workbook.xlsx.readFile(pathFile);
    let worksheet = workbook.worksheets[0];

    // Lấy ObjectId của role "USER" (tên không phân biệt hoa thường)
    let userRole = await roleModel.findOne({ name: /^user$/i });
    if (!userRole) {
        res.status(400).send({ message: "Khong tim thay role USER trong he thong" })
        return
    }

    // Lấy trước danh sách username và email đã tồn tại để check trùng nhanh
    let existingUsers = await userModel.find({}, 'username email');
    let existingUsernames = new Set(existingUsers.map(u => u.username));
    let existingEmails    = new Set(existingUsers.map(u => u.email.toLowerCase()));

    let result = [];

    for (let row = 2; row <= worksheet.rowCount; row++) {
        let errorsInRow = [];
        const contentRow = worksheet.getRow(row);
        let username = contentRow.getCell(1).value;
        let rawEmail = contentRow.getCell(2).value;
        // ExcelJS đọc cell hyperlink dạng { text, hyperlink } thay vì string thuần
        let email = rawEmail && typeof rawEmail === 'object'
            ? (rawEmail.text || rawEmail.hyperlink || '')
            : rawEmail;

        if (!username || String(username).trim() === '') {
            errorsInRow.push("username khong duoc de trong");
        }
        if (!email || String(email).trim() === '') {
            errorsInRow.push("email khong duoc de trong");
        }
        if (username && existingUsernames.has(String(username).trim())) {
            errorsInRow.push("username da ton tai: " + username);
        }
        if (email && existingEmails.has(String(email).trim().toLowerCase())) {
            errorsInRow.push("email da ton tai: " + email);
        }

        if (errorsInRow.length > 0) {
            result.push({ row, errors: errorsInRow });
            continue;
        }

        let plainPassword = generatePassword();
        try {
            let newUser = new userModel({
                username: String(username).trim(),
                password: plainPassword,
                email: String(email).trim().toLowerCase(),
                role: userRole._id
            });
            await newUser.save();

            let newCart = new cartModel({ user: newUser._id });
            await newCart.save();

            // Cập nhật set để các row tiếp theo trong cùng file không bị trùng
            existingUsernames.add(String(username).trim());
            existingEmails.add(String(email).trim().toLowerCase());

            // Gửi email sau khi lưu (dùng plainPassword trước khi bị hash)
            try {
                await sendPasswordEmail(newUser.email, newUser.username, plainPassword);
                result.push({ row, username: newUser.username, email: newUser.email, status: "thanh cong, da gui email" });
            } catch (mailErr) {
                result.push({ row, username: newUser.username, email: newUser.email, status: "tao user thanh cong nhung gui email that bai: " + mailErr.message });
            }
        } catch (error) {
            result.push({ row, errors: [error.message] });
        }
    }

    res.send(result);
})

module.exports = router