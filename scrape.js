const express = require('express');
const axios = require('axios');
const qs = require('qs');
const cheerio = require('cheerio');

const router = express.Router();
const BASE_URL = 'http://clustersme.ppaos.com';

const LOGIN_URL = `${BASE_URL}/login/login.php`;
const INDEX_LOGIN_URL = `${BASE_URL}/index.php?option=dashboard&menu=0&sub=0`;

const FINAL_REDIRECT_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewom&sub=addom';
const FORM_SUBMIT_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewom&sub=addom';
const SUCCESS_REDIRECT_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewom&sub=0';
const VIEW_OM_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewom&sub=0';
const ADD_VC_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=add';
const VIEW_VC_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=0';
const VIEW_PRODUCTS_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewproducts&sub=0';
const ADD_PRODUCT_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=addproduct&id=975';
const VIEW_PRODUCT_BY_VC_URL = 'http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=product&id=975';

async function getSessionCookie() {
    const loginData = qs.stringify({
        username: 'cluster01',
        password: '212224236'
    });

    const loginResponse = await axios.post(LOGIN_URL, loginData, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            'Referer': LOGIN_URL
        },
        maxRedirects: 0,
        validateStatus: status => status < 400
    });

    const cookies = loginResponse.headers['set-cookie'];
    if (!cookies) {
        throw new Error('Login failed. No session cookie received.');
    }
    return cookies.map(cookie => cookie.split(';')[0]).join('; ');
}

async function makeRequest(targetUrl, referUrl, sessionCookie, method = 'get', data = null) {
    const options = {
        method,
        url: targetUrl,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Referer': referUrl,
            'Cookie': sessionCookie,
            'Content-Type': method === 'post' ? 'application/x-www-form-urlencoded' : undefined
        },
        data,
        maxRedirects: 0,
        validateStatus: status => status < 400
    };
    return axios(options);
}

router.get('/scrape', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        await makeRequest(INDEX_LOGIN_URL, LOGIN_URL, sessionCookie);
        const finalResponse = await makeRequest(`${BASE_URL}/?option=cluster&menu=viewom&sub=addom`, INDEX_LOGIN_URL, sessionCookie);
        
        const $ = cheerio.load(finalResponse.data);
        const formInputs = {};

        // Extract input fields
        $('input').each((_, input) => {
            const name = $(input).attr('name');
            const value = $(input).attr('value') || '';
            const label = $(input).closest('label').text().trim() || $(input).prev('label').text().trim();
            if (name) formInputs[name] = { label, value };
        });

        // Extract select fields and their options
        $('select').each((_, select) => {
            const name = $(select).attr('name');
            const selectedValue = $(select).find('option:selected').val() || '';
            const options = $(select).find('option').map((_, option) => ({
                value: $(option).val(),
                text: $(option).text().trim()
            })).get();
            const label = $(select).closest('label').text().trim() || $(select).prev('label').text().trim();
            if (name) {
                formInputs[name] = {
                    label,
                    selected: selectedValue,
                    options: options
                };
            }
        });

        // Extract textarea fields
        $('textarea').each((_, textarea) => {
            const name = $(textarea).attr('name');
            const value = $(textarea).text().trim();
            const label = $(textarea).closest('label').text().trim() || $(textarea).prev('label').text().trim();
            if (name) formInputs[name] = { label, value };
        });

        res.json({ success: true, data: formInputs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/submit', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const formData = qs.stringify({
            om_name: 'ทดสอบระบบ 2',
            om_type: '1',
            om_cluster: '1',
            om_year: '2568',
            om_capital: '1000',
            JUN: '19',
            AMP: '233',
            TMP: '301901',
            om_target: '',
            _wysihtml5_mode: '1',
            om_analyte: '',
            om_recive: '',
            om_activity: '',
            om_output: '',
            om_outcome: '',
            submit: ''
        });

        const submitResponse = await makeRequest(FORM_SUBMIT_URL, FORM_SUBMIT_URL, sessionCookie, 'post', formData);

        if (submitResponse.headers.location === SUCCESS_REDIRECT_URL) {
            return res.json({ success: true, message: 'Form submitted successfully', redirect: SUCCESS_REDIRECT_URL });
        }

        res.status(500).json({ error: 'Unexpected response after form submission' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-om-data', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const response = await makeRequest(VIEW_OM_URL, INDEX_LOGIN_URL, sessionCookie, 'get');

        const $ = cheerio.load(response.data);
        const tableHeaders = [];
        const tableData = [];

        $('#example23 thead tr th').each((_, th) => {
            tableHeaders.push($(th).text().trim());
        });

        $('#example23 tbody tr').each((_, tr) => {
            const row = {};
            const editLink = $(tr).find('a[href*="sub=editom"]').attr('href');
            const idMatch = editLink ? editLink.match(/id=(\d+)/) : null;
            row['ID'] = idMatch ? idMatch[1] : '';
            
            $(tr).find('td').each((index, td) => {
                let cellText = $(td).text().trim();
                let parts;
                
                switch (tableHeaders[index]) {
                    case 'ชื่อโครงการ/งบประมาณ':
                        parts = cellText.split(/\s{2,}/);
                        row['ชื่อโครงการ'] = parts[0]?.trim() || '';
                        row['งบประมาณ'] = parts[1]?.replace('งบประมาณ ', '').trim() || '';
                        break;
                    case 'ประเภท OM / คลัสเตอร์':
                        parts = cellText.split(/\s{2,}/);
                        row['ประเภท OM'] = parts[0]?.trim() || '';
                        row['คลัสเตอร์'] = parts[1]?.trim() || '';
                        break;
                    case 'พื้นที่หลัก':
                        const subdistrict = $(td).contents().first().text().trim();
                        const districtProvince = $(td).find('span.text-muted').text().trim();
                        const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                        row['ตำบล'] = subdistrict;
                        row['อำเภอ'] = district || '';
                        row['จังหวัด'] = province || '';
                        break;
                    case 'ผู้รับผิดชอบ':
                        const responsiblePerson = $(td).contents().first().text().trim();
                        const responsibleRole = $(td).find('span.text-muted').text().trim();
                        row['ผู้รับผิดชอบ'] = responsiblePerson;
                        row['ตำแหน่ง'] = responsibleRole;
                        break;
                    default:
                        row[tableHeaders[index]] = cellText;
                        break;
                }
            });
            tableData.push(row);
        });

        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/add-vc', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const formData = qs.stringify({
            om_ChainName: 'ทดสอบระบบ Value Chain 2',
            om_ChainCluster_id: '1',
            om_master: '467',
            om_provinceID: '19',
            om_ChainAmplurID: '233',
            om_ChainTambonID: '301901',
            submit: ''
        });

        const submitResponse = await makeRequest(ADD_VC_URL, ADD_VC_URL, sessionCookie, 'post', formData);

        res.json({ success: true, message: 'Value Chain added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-vc-data', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const response = await makeRequest(VIEW_VC_URL, INDEX_LOGIN_URL, sessionCookie, 'get');

        const $ = cheerio.load(response.data);
        const tableHeaders = [];
        const tableData = [];

        $('#example23 thead tr th').each((_, th) => {
            tableHeaders.push($(th).text().trim());
        });

        $('#example23 tbody tr').each((_, tr) => {
            const row = {};
            const manageLink = $(tr).find('a[href*="sub=manage"]').attr('href');
            const idMatch = manageLink ? manageLink.match(/id=(\d+)/) : null;
            row['ID'] = idMatch ? idMatch[1] : '';

            $(tr).find('td').each((index, td) => {
                let cellText = $(td).text().trim();
                let parts;
                
                switch (tableHeaders[index]) {
                    case 'ห่วงโซ่มูลค่า/คลัสเตอร์ย่อย':
                        parts = cellText.split(/\s{2,}/);
                        row['ห่วงโซ่มูลค่า'] = parts[0]?.trim() || '';
                        row['คลัสเตอร์ย่อย'] = parts[1]?.trim() || '';
                        break;
                    case 'พื้นที่ดำเนินการ':
                        const subdistrict = $(td).contents().first().text().trim();
                        const districtProvince = $(td).find('span.text-muted').text().trim();
                        const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                        row['ตำบล'] = subdistrict;
                        row['อำเภอ'] = district || '';
                        row['จังหวัด'] = province || '';
                        break;
                    case 'ภายใต้โครงการ/งบประมาณ':
                        const projectLink = $(td).find('a').text().trim();
                        const budget = $(td).find('span.text-muted').text().replace('งบประมาณ ', '').trim();
                        row['ภายใต้โครงการ'] = projectLink;
                        row['งบประมาณ'] = budget;
                        break;
                    case 'ผู้สร้าง':
                        const creator = $(td).contents().first().text().trim();
                        const role = $(td).find('span.text-muted').text().trim();
                        row['ผู้สร้าง'] = creator;
                        row['ตำแหน่ง'] = role;
                        break;
                    default:
                        row[tableHeaders[index]] = cellText;
                        break;
                }
            });
            tableData.push(row);
        });

        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-vc-data-from-om', async (req, res) => {
    try {
        const { omId } = req.query; // รับค่า OM ID จาก query parameter
        if (!omId) {
            return res.status(400).json({ error: 'Missing omId parameter' });
        }

        const sessionCookie = await getSessionCookie();
        const targetUrl = `http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=0&id=${omId}`;

        const response = await makeRequest(targetUrl, VIEW_VC_URL, sessionCookie, 'get');

        const $ = cheerio.load(response.data);
        const tableHeaders = [];
        const tableData = [];

        $('#example23 thead tr th').each((_, th) => {
            tableHeaders.push($(th).text().trim());
        });

        $('#example23 tbody tr').each((_, tr) => {
            const row = {};
            const manageLink = $(tr).find('a[href*="sub=manage"]').attr('href');
            const idMatch = manageLink ? manageLink.match(/id=(\d+)/) : null;
            row['ID'] = idMatch ? idMatch[1] : '';

            $(tr).find('td').each((index, td) => {
                let cellText = $(td).text().trim();
                let parts;

                switch (tableHeaders[index]) {
                    case 'ห่วงโซ่มูลค่า/คลัสเตอร์ย่อย':
                        parts = cellText.split(/\s{2,}/);
                        row['ห่วงโซ่มูลค่า'] = parts[0]?.trim() || '';
                        row['คลัสเตอร์ย่อย'] = parts[1]?.trim() || '';
                        break;
                    case 'พื้นที่ดำเนินการ':
                        const subdistrict = $(td).contents().first().text().trim();
                        const districtProvince = $(td).find('span.text-muted').text().trim();
                        const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                        row['ตำบล'] = subdistrict;
                        row['อำเภอ'] = district || '';
                        row['จังหวัด'] = province || '';
                        break;
                    case 'ภายใต้โครงการ/งบประมาณ':
                        const projectLink = $(td).find('a').text().trim();
                        const budget = $(td).find('span.text-muted').text().replace('งบประมาณ ', '').trim();
                        row['ภายใต้โครงการ'] = projectLink;
                        row['งบประมาณ'] = budget;
                        break;
                    case 'ผู้สร้าง':
                        const creator = $(td).contents().first().text().trim();
                        const role = $(td).find('span.text-muted').text().trim();
                        row['ผู้สร้าง'] = creator;
                        row['ตำแหน่ง'] = role;
                        break;
                    default:
                        row[tableHeaders[index]] = cellText;
                        break;
                }
            });
            tableData.push(row);
        });

        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/add-product', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const formData = qs.stringify({
            om_ChainID: '975',
            om_id: '466',
            provinceID: '19',
            productName: 'สินค้าทดสอบ 2',
            sme_group_product_id: '1',
            productPrice: '100',
            productMaxProductCap: '1000',
            productProductTime: '10',
            productCost: '60',
            productPeriod: 'มกราคม-ธันวาคม',
            productClipVedio: '',
            submit: ''
        });

        const submitResponse = await makeRequest(ADD_PRODUCT_URL, ADD_PRODUCT_URL, sessionCookie, 'post', formData);

        res.json({ success: true, message: 'Product added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-products', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const response = await makeRequest(VIEW_PRODUCTS_URL, INDEX_LOGIN_URL, sessionCookie, 'get');

        const $ = cheerio.load(response.data);
        const tableHeaders = [];
        const tableData = [];

        $('#example23 thead tr th').each((_, th) => {
            tableHeaders.push($(th).text().trim());
        });

        $('#example23 tbody tr').each((_, tr) => {
            const row = {};
            $(tr).find('td').each((index, td) => {
                let cellText = $(td).text().trim();
                let parts;

                switch (tableHeaders[index]) {
                    case 'สินค้า/กลุ่มผลิตภัณฑ์':
                        parts = cellText.split(/\s{2,}/);
                        row['สินค้า'] = $(td).find('strong').text().trim();
                        row['กลุ่มผลิตภัณฑ์'] = $(td).find('span.text-muted').text().trim();
                        break;
                    case 'VC/OM':
                        parts = cellText.split(/\s{2,}/);
                        row['VC'] = parts[0]?.replace('VC : ', '').trim() || '';
                        row['OM'] = parts[1]?.replace('OM : ', '').trim() || '';
                        break;
                    case 'พื้นที่ผลิต':
                        const subdistrict = $(td).contents().first().text().trim();
                        const districtProvince = $(td).find('span.text-muted').text().trim();
                        const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                        row['ตำบล'] = subdistrict;
                        row['อำเภอ'] = district || '';
                        row['จังหวัด'] = province || '';
                        break;
                    case 'ราคาขาย/ทุน':
                        const salePrice = $(td).contents().first().text().replace('ราคาขาย : ', '').trim();
                        const costPrice = $(td).find('span.text-muted').text().replace('ราคาทุน : ', '').trim();
                        row['ราคาขาย'] = salePrice;
                        row['ราคาทุน'] = costPrice;
                        break;
                    case 'ระยะเวลาการผลิต (วัน)':
                        const productionTime = $(td).contents().first().text().trim();
                        const duration = $(td).find('span.text-muted').text().replace('ระยะเวลา : ', '').trim();
                        row['ระยะเวลาผลิต'] = productionTime;
                        row['ระยะเวลา'] = duration;
                        break;
                    default:
                        row[tableHeaders[index]] = cellText;
                        break;
                }
            });
            tableData.push(row);
        });

        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-products-by-vc', async (req, res) => {
    try {
        const { vcId } = req.query; // รับค่า OM ID จาก query parameter
        if (!vcId) {
            return res.status(400).json({ error: 'Missing vcId parameter' });
        }

        const sessionCookie = await getSessionCookie();

        const targetUrl = `http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=product&id=${vcId}`;
        
        const response = await makeRequest(targetUrl, targetUrl, sessionCookie, 'get');

        const $ = cheerio.load(response.data);
        const tableData = [];

        $('#example23 tbody tr').each((_, tr) => {
            const row = {};
            const cells = $(tr).find('td');

            const editLink = $(cells[1]).find('a[href*="sub=editproduct"]').attr('href');
            row['ID'] = editLink ? editLink.match(/id=(\d+)/)?.[1] || '' : '';
            row['ชื่อสินค้า'] = $(cells[2]).text().trim();
            row['กลุ่มผลิตภัณฑ์'] = $(cells[3]).text().trim();
            row['ราคาขาย'] = $(cells[4]).text().trim();
            row['กำลังการผลิตสูงสุด/เดือน'] = $(cells[5]).text().trim();
            row['ระยะเวลาการผลิต (วัน)'] = $(cells[6]).text().trim();
            row['ต้นทุนการผลิต/ชิ้น'] = $(cells[7]).text().trim();
            row['ช่วงที่ผลิตได้'] = $(cells[8]).text().trim();

            tableData.push(row);
        });

        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-full-chain-data', async (req, res) => {
    try {
        console.log("Fetching OM data...");
        const omResponse = await axios.get('https://gateway.cloudrestfulapi.com/scrape/get-om-data');

        if (!omResponse.data.success || !Array.isArray(omResponse.data.data)) {
            throw new Error('Invalid OM response format');
        }

        const omData = omResponse.data.data;
        const vcData = [];
        const productData = [];

        for (const om of omData) {
            try {
                console.log(`Fetching VC data for OM ID: ${om.ID}...`);
                const vcResponse = await axios.get(`https://gateway.cloudrestfulapi.com/scrape/get-vc-data-from-om?omId=${om.ID}`);

                if (vcResponse.data.success && Array.isArray(vcResponse.data.data)) {
                    vcResponse.data.data.forEach(vc => vcData.push({ ...vc, OM_ID: om.ID }));
                } else {
                    console.warn(`Invalid VC response for OM ID: ${om.ID}`);
                }
            } catch (vcError) {
                console.error(`Failed to fetch VC data for OM ID: ${om.ID}`, vcError.message);
            }
        }

        for (const vc of vcData) {
            try {
                console.log(`Fetching Product data for VC ID: ${vc.ID}...`);
                const productResponse = await axios.get(`https://gateway.cloudrestfulapi.com/scrape/get-products-by-vc?vcId=${vc.ID}`);

                if (productResponse.data.success && Array.isArray(productResponse.data.data)) {
                    productResponse.data.data.forEach(product => productData.push({ ...product, VC_ID: vc.ID }));
                } else {
                    console.warn(`Invalid Product response for VC ID: ${vc.ID}`);
                }
            } catch (productError) {
                console.error(`Failed to fetch Product data for VC ID: ${vc.ID}`, productError.message);
            }
        }

        console.log("Returning full chain data...");
        res.json({ success: true, data: { omData, vcData, productData } });

    } catch (error) {
        console.error("Error in /get-full-chain-data:", error.message);
        res.status(500).json({ error: error.message });
    }
});



module.exports = router;