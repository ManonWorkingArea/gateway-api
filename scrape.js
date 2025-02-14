const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { JSDOM } = require('jsdom');

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
    const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Referer': referUrl,
        'Cookie': sessionCookie,
    };

    // Set Content-Type only for POST requests
    if (method === 'post') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const options = {
        method,
        url: targetUrl,
        headers,
        data,
        maxRedirects: 0,
        validateStatus: status => status < 400
    };

    return axios(options);
}

async function parseHTML(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const formInputs = {};

    // Extract input fields
    document.querySelectorAll('input').forEach(input => {
        const name = input.name;
        const value = input.value || '';
        const label = input.closest('label')?.textContent?.trim() || '';
        if (name) formInputs[name] = { label, value };
    });

    // Extract select fields and options
    document.querySelectorAll('select').forEach(select => {
        const name = select.name;
        const selectedValue = select.value;
        const options = [...select.options].map(option => ({
            value: option.value,
            text: option.textContent.trim(),
        }));
        const label = select.closest('label')?.textContent?.trim() || '';
        if (name) {
            formInputs[name] = { label, selected: selectedValue, options };
        }
    });

    // Extract textarea fields
    document.querySelectorAll('textarea').forEach(textarea => {
        const name = textarea.name;
        const value = textarea.value.trim();
        const label = textarea.closest('label')?.textContent?.trim() || '';
        if (name) formInputs[name] = { label, value };
    });

    return formInputs;
}

router.get('/scrape', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        await makeRequest(INDEX_LOGIN_URL, LOGIN_URL, sessionCookie);
        const finalResponse = await makeRequest(`${BASE_URL}/?option=cluster&menu=viewom&sub=addom`, INDEX_LOGIN_URL, sessionCookie);

        const formInputs = await parseHTML(finalResponse.data);
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

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            // Extract table headers
            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

            // Extract table rows
            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const row = {};
                const editLink = tr.querySelector('a[href*="sub=editom"]')?.getAttribute('href');
                const idMatch = editLink ? editLink.match(/id=(\d+)/) : null;
                row['ID'] = idMatch ? idMatch[1] : '';

                tr.querySelectorAll('td').forEach((td, index) => {
                    let cellText = td.textContent.trim();
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
                            const subdistrict = td.childNodes[0]?.textContent.trim() || '';
                            const districtProvince = td.querySelector('span.text-muted')?.textContent.trim() || '';
                            const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                            row['ตำบล'] = subdistrict;
                            row['อำเภอ'] = district || '';
                            row['จังหวัด'] = province || '';
                            break;
                        case 'ผู้รับผิดชอบ':
                            const responsiblePerson = td.childNodes[0]?.textContent.trim() || '';
                            const responsibleRole = td.querySelector('span.text-muted')?.textContent.trim() || '';
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

            return tableData;
        };

        const tableData = parseTableData(response.data);
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

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            // Extract table headers
            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

            // Extract table rows
            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const row = {};
                const manageLink = tr.querySelector('a[href*="sub=manage"]')?.getAttribute('href');
                const idMatch = manageLink ? manageLink.match(/id=(\d+)/) : null;
                row['ID'] = idMatch ? idMatch[1] : '';

                tr.querySelectorAll('td').forEach((td, index) => {
                    let cellText = td.textContent.trim();
                    let parts;

                    switch (tableHeaders[index]) {
                        case 'ห่วงโซ่มูลค่า/คลัสเตอร์ย่อย':
                            parts = cellText.split(/\s{2,}/);
                            row['ห่วงโซ่มูลค่า'] = parts[0]?.trim() || '';
                            row['คลัสเตอร์ย่อย'] = parts[1]?.trim() || '';
                            break;
                        case 'พื้นที่ดำเนินการ':
                            const subdistrict = td.childNodes[0]?.textContent.trim() || '';
                            const districtProvince = td.querySelector('span.text-muted')?.textContent.trim() || '';
                            const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                            row['ตำบล'] = subdistrict;
                            row['อำเภอ'] = district || '';
                            row['จังหวัด'] = province || '';
                            break;
                        case 'ภายใต้โครงการ/งบประมาณ':
                            const projectLink = td.querySelector('a')?.textContent.trim() || '';
                            const budget = td.querySelector('span.text-muted')?.textContent.replace('งบประมาณ ', '').trim() || '';
                            row['ภายใต้โครงการ'] = projectLink;
                            row['งบประมาณ'] = budget;
                            break;
                        case 'ผู้สร้าง':
                            const creator = td.childNodes[0]?.textContent.trim() || '';
                            const role = td.querySelector('span.text-muted')?.textContent.trim() || '';
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

            return tableData;
        };

        const tableData = parseTableData(response.data);
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

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            // Extract table headers
            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

            // Extract table rows
            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const row = {};
                const manageLink = tr.querySelector('a[href*="sub=manage"]')?.getAttribute('href');
                const idMatch = manageLink ? manageLink.match(/id=(\d+)/) : null;
                row['ID'] = idMatch ? idMatch[1] : '';

                tr.querySelectorAll('td').forEach((td, index) => {
                    let cellText = td.textContent.trim();
                    let parts;

                    switch (tableHeaders[index]) {
                        case 'ห่วงโซ่มูลค่า/คลัสเตอร์ย่อย':
                            parts = cellText.split(/\s{2,}/);
                            row['ห่วงโซ่มูลค่า'] = parts[0]?.trim() || '';
                            row['คลัสเตอร์ย่อย'] = parts[1]?.trim() || '';
                            break;
                        case 'พื้นที่ดำเนินการ':
                            const subdistrict = td.childNodes[0]?.textContent.trim() || '';
                            const districtProvince = td.querySelector('span.text-muted')?.textContent.trim() || '';
                            const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                            row['ตำบล'] = subdistrict;
                            row['อำเภอ'] = district || '';
                            row['จังหวัด'] = province || '';
                            break;
                        case 'ภายใต้โครงการ/งบประมาณ':
                            const projectLink = td.querySelector('a')?.textContent.trim() || '';
                            const budget = td.querySelector('span.text-muted')?.textContent.replace('งบประมาณ ', '').trim() || '';
                            row['ภายใต้โครงการ'] = projectLink;
                            row['งบประมาณ'] = budget;
                            break;
                        case 'ผู้สร้าง':
                            const creator = td.childNodes[0]?.textContent.trim() || '';
                            const role = td.querySelector('span.text-muted')?.textContent.trim() || '';
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

            return tableData;
        };

        const tableData = parseTableData(response.data);
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

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            // Extract table headers
            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

            // Extract table rows
            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const row = {};

                tr.querySelectorAll('td').forEach((td, index) => {
                    let cellText = td.textContent.trim();
                    let parts;

                    switch (tableHeaders[index]) {
                        case 'สินค้า/กลุ่มผลิตภัณฑ์':
                            row['สินค้า'] = td.querySelector('strong')?.textContent.trim() || '';
                            row['กลุ่มผลิตภัณฑ์'] = td.querySelector('span.text-muted')?.textContent.trim() || '';
                            break;
                        case 'VC/OM':
                            parts = cellText.split(/\s{2,}/);
                            row['VC'] = parts[0]?.replace('VC : ', '').trim() || '';
                            row['OM'] = parts[1]?.replace('OM : ', '').trim() || '';
                            break;
                        case 'พื้นที่ผลิต':
                            const subdistrict = td.childNodes[0]?.textContent.trim() || '';
                            const districtProvince = td.querySelector('span.text-muted')?.textContent.trim() || '';
                            const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                            row['ตำบล'] = subdistrict;
                            row['อำเภอ'] = district || '';
                            row['จังหวัด'] = province || '';
                            break;
                        case 'ราคาขาย/ทุน':
                            row['ราคาขาย'] = td.childNodes[0]?.textContent.replace('ราคาขาย : ', '').trim() || '';
                            row['ราคาทุน'] = td.querySelector('span.text-muted')?.textContent.replace('ราคาทุน : ', '').trim() || '';
                            break;
                        case 'ระยะเวลาการผลิต (วัน)':
                            row['ระยะเวลาผลิต'] = td.childNodes[0]?.textContent.trim() || '';
                            row['ระยะเวลา'] = td.querySelector('span.text-muted')?.textContent.replace('ระยะเวลา : ', '').trim() || '';
                            break;
                        default:
                            row[tableHeaders[index]] = cellText;
                            break;
                    }
                });

                tableData.push(row);
            });

            return tableData;
        };

        const tableData = parseTableData(response.data);
        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-products-by-vc', async (req, res) => {
    try {
        const { vcId } = req.query; // รับค่า VC ID จาก query parameter
        if (!vcId) {
            return res.status(400).json({ error: 'Missing vcId parameter' });
        }

        const sessionCookie = await getSessionCookie();
        const targetUrl = `http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=product&id=${vcId}`;
        const response = await makeRequest(targetUrl, targetUrl, sessionCookie, 'get');

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableData = [];

            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const row = {};
                const cells = tr.querySelectorAll('td');

                const editLink = cells[1]?.querySelector('a[href*="sub=editproduct"]')?.getAttribute('href');
                row['ID'] = editLink ? editLink.match(/id=(\d+)/)?.[1] || '' : '';
                row['ชื่อสินค้า'] = cells[2]?.textContent.trim() || '';
                row['กลุ่มผลิตภัณฑ์'] = cells[3]?.textContent.trim() || '';
                row['ราคาขาย'] = cells[4]?.textContent.trim() || '';
                row['กำลังการผลิตสูงสุด/เดือน'] = cells[5]?.textContent.trim() || '';
                row['ระยะเวลาการผลิต (วัน)'] = cells[6]?.textContent.trim() || '';
                row['ต้นทุนการผลิต/ชิ้น'] = cells[7]?.textContent.trim() || '';
                row['ช่วงที่ผลิตได้'] = cells[8]?.textContent.trim() || '';

                tableData.push(row);
            });

            return tableData;
        };

        const tableData = parseTableData(response.data);
        res.json({ success: true, data: tableData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-full-chain-data', async (req, res) => {
    try {
        // Step 1: Get all OM data from external API
        const omResponse = await axios.get('https://gateway.cloudrestfulapi.com/scrape/get-om-data');
        if (!omResponse.data.success) {
            throw new Error('Failed to fetch OM data');
        }
        const omData = omResponse.data.data;
        const vcData = [];
        const productData = [];
        
        // Step 2: Get VC data for each OM
        for (const om of omData) {
            const vcResponse = await axios.get(`https://gateway.cloudrestfulapi.com/scrape/get-vc-data-from-om?omId=${om.ID}`);
            if (vcResponse.data.success) {
                const vcs = vcResponse.data.data;
                vcs.forEach(vc => vcData.push({ ...vc, OM_ID: om.ID }));
            }
        }
        
        // Step 3: Get Product data for each VC
        for (const vc of vcData) {
            const productResponse = await axios.get(`https://gateway.cloudrestfulapi.com/scrape/get-products-by-vc?vcId=${vc.ID}`);
            if (productResponse.data.success) {
                const products = productResponse.data.data;
                products.forEach(product => productData.push({ ...product, VC_ID: vc.ID }));
            }
        }
        
        res.json({ success: true, data: { omData, vcData, productData } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


module.exports = router;