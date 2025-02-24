const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { JSDOM } = require('jsdom');
const router = express.Router();
const { redisClient } = require('./routes/middleware/redis');  // Import Redis client

const BASE_URL              = 'http://clustersme.ppaos.com';
const LOGIN_URL             = `${BASE_URL}/login/login.php`;
const INDEX_LOGIN_URL       = `${BASE_URL}/index.php?option=dashboard&menu=0&sub=0`;
const SET_YEAR_URL          = 'http://clustersme.ppaos.com/include_year_post.php';
const FORM_SUBMIT_URL       = `${BASE_URL}/?option=cluster&menu=viewom&sub=addom`;
const SUCCESS_REDIRECT_URL  = `${BASE_URL}/?option=cluster&menu=viewom&sub=0`;
const VIEW_OM_URL           = `${BASE_URL}/?option=cluster&menu=viewom&sub=0`;
const ADD_VC_URL            = `${BASE_URL}/?option=cluster&menu=viewchain&sub=add`;
const VIEW_VC_URL           = `${BASE_URL}/?option=cluster&menu=viewchain&sub=0`;
const VIEW_PRODUCTS_URL     = `${BASE_URL}/?option=cluster&menu=viewproducts&sub=0`;
const ADD_PRODUCT_URL       = `${BASE_URL}/?option=cluster&menu=viewchain&sub=addproduct&id=`;
const CLUSTER_URL           = `${BASE_URL}/?option=cluster&menu=manage&sub=viewall`;

// Function to get session cookie per user
async function getSessionCookie(username, password) {
    try {
        const cacheKey = `session_cookie:${username}`;
        const cachedSession = await redisClient.get(cacheKey);

        if (cachedSession) {
            console.log(`Using cached session for user ${username}`);
            return cachedSession;
        }

        console.log(`Logging in user ${username} to fetch new session...`);
        const loginData = qs.stringify({ username, password });

        const loginResponse = await axios.post(LOGIN_URL, loginData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 0,
            validateStatus: status => status < 400
        });

        const cookies = loginResponse.headers['set-cookie'];
        if (!cookies) throw new Error(`Login failed for user ${username}. No session cookie received.`);

        const sessionCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');

        // Store session cookie in Redis with a TTL of 10 minutes
        await redisClient.setEx(cacheKey, 600, sessionCookie);
        console.log(`Stored session for user ${username} in Redis`);

        return sessionCookie;
    } catch (error) {
        console.error(`Error in getSessionCookie for user ${username}:`, error.message);
        throw new Error(`Failed to retrieve session for user ${username}`);
    }
}

// Function to make HTTP requests using session cookies
async function makeRequest(targetUrl, referUrl, sessionCookie, method = 'get', data = null) {
    const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Referer': referUrl,
        'Cookie': sessionCookie,
    };

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

// Function to extract year and username
function extractYearAndUsername(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Extract Year from the dropdown
    const yearElement = document.querySelector('.navbar-top-links .dropdown-toggle span.hidden-xs');
    const selectedYear = yearElement ? yearElement.textContent.trim() : null;

    // Extract Username from profile section
    const usernameElement = document.querySelector('.navbar-top-links .profile-pic b.hidden-xs');
    const username = usernameElement ? usernameElement.textContent.trim() : null;

    return { selectedYear, username };
}

/**
 * GET /scrape
 * Fetches form input fields and session information.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 */
router.get('/scrape', async (req, res) => {
    try {
        const { username, password } = req.query;
        if (!username || !password) {
            return res.status(400).json({ error: 'Missing username or password' });
        }

        const sessionCookie = await getSessionCookie(username, password);
        await makeRequest(INDEX_LOGIN_URL, LOGIN_URL, sessionCookie);
        const finalResponse = await makeRequest(`${BASE_URL}/?option=cluster&menu=viewom&sub=addom`, INDEX_LOGIN_URL, sessionCookie);

        const formInputs = await parseHTML(finalResponse.data);

        const { selectedYear, username: extractedUsername } = extractYearAndUsername(finalResponse.data);

        res.json({ 
            success: true, 
            data: { 
                formInputs, 
                selectedYear, 
                username: extractedUsername 
            } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /submit
 * Submits a form to create an OM entry.
 */
router.post('/submit', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const formData = qs.stringify({
            om_name: 'OM Test C',
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

/**
 * GET /get-cluster-data
 * Fetches cluster data for a specific year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter cluster data.
 */
router.get('/get-cluster-data', async (req, res) => {
    try {
        const { username, password, year } = req.query;
        if (!username || !password || !year) {
            return res.status(400).json({ error: 'Missing username, password, or year' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        const setYearData = `years=${year}&submit_session_year=1`;

        await makeRequest(SET_YEAR_URL, CLUSTER_URL, sessionCookie, 'post', setYearData);

        const response = await makeRequest(CLUSTER_URL, CLUSTER_URL, sessionCookie, 'get');

        const parseClusterTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableData = [];

            document.querySelectorAll('#example23 tbody tr').forEach(tr => {
                const cells = tr.querySelectorAll('td');

                const manageLink = tr.querySelector('a[href*="sub=manage"]')?.getAttribute('href');
                const idMatch = manageLink ? manageLink.match(/id=(\d+)/) : null;

                tableData.push({
                    ID: idMatch ? idMatch[1] : '',
                    Year: cells[2]?.textContent.trim() || '',
                    ClusterName: cells[3]?.textContent.trim() || '',
                    OperationAreas: cells[4]?.textContent.trim() || '',
                    Description: cells[5]?.textContent.trim() || '',
                    Creator: cells[6]?.textContent.trim() || '',
                });
            });

            return tableData;
        };

        const clusterData = parseClusterTableData(response.data);

        res.json({ 
            success: true, 
            year: year,
            data: clusterData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-products-by-cluster
 * Fetches products associated with a specific Cluster ID and Year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter data.
 * @query {string} clusterId - The Cluster ID to fetch associated products.
 */
router.get('/get-products-by-cluster', async (req, res) => {
    try {
        const { username, password, year, clusterId } = req.query;
        if (!username || !password || !year || !clusterId) {
            return res.status(400).json({ error: 'Missing username, password, year, or clusterId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Set the session year
        const setYearData = `years=${year}&submit_session_year=1`;
        await makeRequest(SET_YEAR_URL, CLUSTER_URL, sessionCookie, 'post', setYearData);

        // Fetch product data for the cluster
        const targetUrl = `${BASE_URL}/?option=cluster&menu=manage&sub=manage&id=${clusterId}`;
        const response = await makeRequest(targetUrl, CLUSTER_URL, sessionCookie, 'get');

        const parseProductTable = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableData = [];

            document.querySelectorAll('#examplePoor tbody tr').forEach(tr => {
                const row = {};
                const cells = tr.querySelectorAll('td');

                row['ID'] = cells[0]?.querySelector('input[type="checkbox"]')?.value || '';
                row['ชื่อสินค้า'] = cells[3]?.querySelector('strong')?.textContent.trim() || '';
                row['กลุ่มผลิตภัณฑ์'] = cells[3]?.querySelector('span.text-muted')?.textContent.trim() || '';

                const vcOmText = cells[4]?.innerHTML.split('<br>');
                row['VC'] = vcOmText[0]?.replace('VC : ', '').trim() || '';
                row['OM'] = vcOmText[1]?.replace('OM : ', '').trim() || '';

                const locationText = cells[5]?.innerHTML.split('<br>');
                row['ตำบล'] = locationText[0]?.trim() || '';
                const districtProvince = locationText[1]?.replace('<span class="text-muted">', '').replace('</span>', '').trim();
                const [district, province] = districtProvince.replace('อ.', '').replace('จ.', '').split(' ');
                row['อำเภอ'] = district || '';
                row['จังหวัด'] = province || '';

                const priceText = cells[6]?.innerHTML.split('<br>');
                row['ราคาขาย'] = priceText[0]?.replace('ราคาขาย : ', '').trim() || '';
                row['ราคาทุน'] = priceText[1]?.replace('<span class="text-muted">ราคาทุน : ', '').replace('</span>', '').trim() || '';

                const productionTimeText = cells[7]?.innerHTML.split('<br>');
                row['ช่วงที่ผลิตได้'] = productionTimeText[0]?.trim() || '';
                row['ระยะเวลาการผลิต'] = productionTimeText[1]?.replace('<span class="text-muted">ระยะเวลา : ', '').replace('</span>', '').trim() || '';

                tableData.push(row);
            });

            return tableData;
        };

        const tableData = parseProductTable(response.data);

        res.json({ 
            success: true, 
            requestedYear: year,
            clusterId,
            data: tableData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-suppliers-by-cluster
 * Fetches suppliers associated with a specific Cluster ID and Year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter data.
 * @query {string} clusterId - The Cluster ID to fetch associated suppliers.
 */
/**
 * GET /get-suppliers-by-cluster
 * Fetches suppliers associated with a specific Cluster ID and Year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter data.
 * @query {string} clusterId - The Cluster ID to fetch associated suppliers.
 */
router.get('/get-suppliers-by-cluster', async (req, res) => {
    try {
        const { username, password, year, clusterId } = req.query;
        if (!username || !password || !year || !clusterId) {
            return res.status(400).json({ error: 'Missing username, password, year, or clusterId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Set the session year
        const setYearData = `years=${year}&submit_session_year=1`;
        await makeRequest(SET_YEAR_URL, CLUSTER_URL, sessionCookie, 'post', setYearData);

        // Fetch supplier data for the cluster
        const targetUrl = `${BASE_URL}/?option=cluster&menu=manage&sub=manage&id=${clusterId}`;
        const response = await makeRequest(targetUrl, CLUSTER_URL, sessionCookie, 'get');

        const parseSupplierTable = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableData = [];

            document.querySelectorAll('#exampleSme tbody tr').forEach(tr => {
                const row = {};
                const cells = tr.querySelectorAll('td');

                row['ID'] = cells[0]?.querySelector('input[type="checkbox"]')?.value || '';
                row['ชื่อผู้ประกอบการ'] = cells[2]?.querySelector('strong')?.textContent.trim() || '';
                row['เลขทะเบียน'] = cells[2]?.querySelector('span.text-muted')?.textContent.replace('เลขทะเบียน : ', '').trim() || '';

                row['กลุ่มของสินค้า'] = cells[3]?.childNodes[0]?.textContent.trim() || '';
                row['ประเภทธุรกิจ'] = cells[3]?.querySelector('span.text-muted')?.textContent.replace('ประเภทธุรกิจ : ', '').trim() || '';

                row['ผู้ประสานงาน'] = cells[4]?.childNodes[0]?.textContent.trim() || '';
                row['เบอร์โทร'] = cells[4]?.querySelector('span.text-muted')?.textContent.trim() || '';

                // Extract OM name
                row['OM'] = cells[5]?.childNodes[0]?.textContent.replace('OM : ', '').trim() || '';

                // Extract location details (fixing extra spaces and line breaks)
                const locationText = cells[5]?.querySelector('span.text-muted')?.textContent.replace(/\s+/g, ' ').trim();
                if (locationText) {
                    const locationParts = locationText.match(/หมู่ที่ (\d+).*ต\.\s*([\S]+).*อ\.\s*([\S]+).*จ\.\s*([\S]+).*รหัสไปรษณีย์ (\d+)/);
                    row['หมู่ที่'] = locationParts ? locationParts[1] : '';
                    row['ตำบล'] = locationParts ? locationParts[2] : '';
                    row['อำเภอ'] = locationParts ? locationParts[3] : '';
                    row['จังหวัด'] = locationParts ? locationParts[4] : '';
                    row['รหัสไปรษณีย์'] = locationParts ? locationParts[5] : '';
                }

                tableData.push(row);
            });

            return tableData;
        };

        const tableData = parseSupplierTable(response.data);

        res.json({ 
            success: true, 
            requestedYear: year,
            clusterId,
            data: tableData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /add-cluster-product
 * Adds a product to a specific Cluster.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @body {string} clusterId - The Cluster ID.
 * @body {string} productId - The Product ID.
 */
router.post('/add-cluster-product', async (req, res) => {
    try {
        const { username, password } = req.query;
        const { clusterId, productId } = req.body;

        if (!username || !password || !clusterId || !productId) {
            return res.status(400).json({ error: 'Missing username, password, clusterId, or productId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Prepare the form data
        const formData = qs.stringify({
            clsSmeID: clusterId,
            coderef: productId,
            souce: '1',
            submit: '1'
        });

        const submitResponse = await makeRequest(
            `${BASE_URL}/cluster_sme/cluster_post_add_products.php`,
            CLUSTER_URL,
            sessionCookie,
            'post',
            formData
        );

        // Validate response (check if the operation succeeded)
        if (submitResponse.status === 200) {
            return res.json({ success: true, message: 'Product added to cluster successfully' });
        }

        res.status(500).json({ error: 'Unexpected response after adding product to cluster' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /add-cluster-supplier
 * Adds a supplier to a specific Cluster.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @body {string} clusterId - The Cluster ID.
 * @body {string} supplierId - The Supplier ID.
 */
router.post('/add-cluster-supplier', async (req, res) => {
    try {
        const { username, password } = req.query;
        const { clusterId, supplierId } = req.body;

        if (!username || !password || !clusterId || !supplierId) {
            return res.status(400).json({ error: 'Missing username, password, clusterId, or supplierId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Prepare the form data
        const formData = qs.stringify({
            clsSmeID: clusterId,
            coderef: supplierId,
            souce: '2',
            submit: '1'
        });

        const submitResponse = await makeRequest(
            `${BASE_URL}/cluster_sme/cluster_post_add_sme.php`,
            CLUSTER_URL,
            sessionCookie,
            'post',
            formData
        );

        // Validate response (check if the operation succeeded)
        if (submitResponse.status === 200) {
            return res.json({ success: true, message: 'Supplier added to cluster successfully' });
        }

        res.status(500).json({ error: 'Unexpected response after adding supplier to cluster' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-om-data
 * Fetches OM data for a specific year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter OM data.
 */
router.get('/get-om-data', async (req, res) => {
    try {
        const { username, password, year } = req.query;
        if (!username || !password || !year) {
            return res.status(400).json({ error: 'Missing username, password, or year' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        const setYearData = `years=${year}&submit_session_year=1`;

        await makeRequest(SET_YEAR_URL, VIEW_OM_URL, sessionCookie, 'post', setYearData);

        const response = await makeRequest(VIEW_OM_URL, VIEW_OM_URL, sessionCookie, 'get');

        const extractYearAndUsername = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            
            const yearElement = document.querySelector('.navbar-top-links .dropdown-toggle span.hidden-xs');
            const selectedYear = yearElement ? yearElement.textContent.trim() : null;

            const usernameElement = document.querySelector('.navbar-top-links .profile-pic b.hidden-xs');
            const extractedUsername = usernameElement ? usernameElement.textContent.trim() : null;

            return { selectedYear, username: extractedUsername };
        };

        const parseOMTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

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

        const { selectedYear, username: extractedUsername } = extractYearAndUsername(response.data);
        const tableData = parseOMTableData(response.data);

        res.json({ 
            success: true, 
            requestedYear: year,
            selectedYear, 
            username: extractedUsername,
            data: tableData
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /add-vc
 * Adds a new Value Chain (VC) entry.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year for which the VC is being added.
 * @body {string} om_ChainName - The name of the Value Chain.
 * @body {string} om_ChainCluster_id - The associated Cluster ID.
 * @body {string} om_master - The master ID.
 * @body {string} om_provinceID - The province ID.
 * @body {string} om_ChainAmplurID - The district ID.
 * @body {string} om_ChainTambonID - The subdistrict ID.
 */
router.post('/add-vc', async (req, res) => {
    try {
        const { username, password, year } = req.query;
        const {
            om_ChainName,
            om_ChainCluster_id,
            om_master,
            om_provinceID,
            om_ChainAmplurID,
            om_ChainTambonID,
        } = req.body;

        if (!username || !password || !year || !om_ChainName || !om_ChainCluster_id || !om_master || !om_provinceID || !om_ChainAmplurID || !om_ChainTambonID) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Set session year
        const setYearData = `years=${year}&submit_session_year=1`;
        await makeRequest(SET_YEAR_URL, ADD_VC_URL, sessionCookie, 'post', setYearData);

        // Prepare form data for VC creation
        const formData = qs.stringify({
            om_ChainName,
            om_ChainCluster_id,
            om_master,
            om_provinceID,
            om_ChainAmplurID,
            om_ChainTambonID,
            submit: ''
        });

        const submitResponse = await makeRequest(ADD_VC_URL, ADD_VC_URL, sessionCookie, 'post', formData);

        res.json({ success: true, message: 'Value Chain added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-vc-data
 * Fetches Value Chain (VC) data for a specific year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter VC data.
 */
router.get('/get-vc-data', async (req, res) => {
    try {
        const { username, password, year } = req.query;
        if (!username || !password || !year) {
            return res.status(400).json({ error: 'Missing username, password, or year' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        const setYearData = `years=${year}&submit_session_year=1`;

        await makeRequest(SET_YEAR_URL, VIEW_VC_URL, sessionCookie, 'post', setYearData);

        const response = await makeRequest(VIEW_VC_URL, VIEW_VC_URL, sessionCookie, 'get');

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

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

        res.json({ 
            success: true, 
            requestedYear: year,
            data: tableData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-vc-data-from-om
 * Fetches Value Chain (VC) data linked to an OM.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter data.
 * @query {string} omId - The OM ID to fetch associated VC data.
 */
router.get('/get-vc-data-from-om', async (req, res) => {
    try {
        const { username, password, year, omId } = req.query;
        if (!username || !password || !year || !omId) {
            return res.status(400).json({ error: 'Missing username, password, year, or omId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        const setYearData = `years=${year}&submit_session_year=1`;

        await makeRequest(SET_YEAR_URL, VIEW_VC_URL, sessionCookie, 'post', setYearData);

        const targetUrl = `http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=0&id=${omId}`;
        const response = await makeRequest(targetUrl, VIEW_VC_URL, sessionCookie, 'get');

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

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

        res.json({ 
            success: true, 
            requestedYear: year,
            omId: omId,
            data: tableData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /add-product
 * Adds a new product to a Value Chain (VC).
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year for which the product is being added.
 * @body {string} om_ChainID - The Value Chain ID.
 * @body {string} om_id - The OM ID.
 * @body {string} provinceID - The Province ID.
 * @body {string} productName - The name of the product.
 * @body {string} sme_group_product_id - The SME group product ID.
 * @body {string} productPrice - The selling price of the product.
 * @body {string} productMaxProductCap - The maximum production capacity.
 * @body {string} productProductTime - The production time in days.
 * @body {string} productCost - The production cost per unit.
 * @body {string} productPeriod - The production period.
 */
router.post('/add-product', async (req, res) => {
    try {
        const { username, password, year } = req.query;
        const {
            om_ChainID,
            om_id,
            provinceID,
            productName,
            sme_group_product_id,
            productPrice,
            productMaxProductCap,
            productProductTime,
            productCost,
            productPeriod,
        } = req.body;

        if (!username || !password || !year || !om_ChainID || !om_id || !provinceID || !productName || !sme_group_product_id || !productPrice || !productMaxProductCap || !productProductTime || !productCost || !productPeriod) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        // Set session year
        const setYearData = `years=${year}&submit_session_year=1`;
        await makeRequest(SET_YEAR_URL, ADD_PRODUCT_URL + om_ChainID, sessionCookie, 'post', setYearData);

        // Prepare form data
        const formData = qs.stringify({
            om_ChainID,
            om_id,
            provinceID,
            productName,
            sme_group_product_id,
            productPrice,
            productMaxProductCap,
            productProductTime,
            productCost,
            productPeriod,
            productClipVedio: '',
            submit: ''
        });

        const submitResponse = await makeRequest(ADD_PRODUCT_URL + om_ChainID, ADD_PRODUCT_URL + om_ChainID, sessionCookie, 'post', formData);

        res.json({ success: true, message: 'Product added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-products
 * Fetches all products.
 */
router.get('/get-products', async (req, res) => {
    try {
        const sessionCookie = await getSessionCookie();
        const response = await makeRequest(VIEW_PRODUCTS_URL, INDEX_LOGIN_URL, sessionCookie, 'get');

        const parseTableData = (html) => {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            const tableHeaders = [];
            const tableData = [];

            document.querySelectorAll('#example23 thead tr th').forEach(th => {
                tableHeaders.push(th.textContent.trim());
            });

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

/**
 * GET /get-products-by-vc
 * Fetches products associated with a specific VC.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to filter data.
 * @query {string} vcId - The Value Chain ID to fetch associated products.
 */
router.get('/get-products-by-vc', async (req, res) => {
    try {
        const { username, password, year, vcId } = req.query;
        if (!username || !password || !year || !vcId) {
            return res.status(400).json({ error: 'Missing username, password, year, or vcId parameter' });
        }

        const sessionCookie = await getSessionCookie(username, password);

        const setYearData = `years=${year}&submit_session_year=1`;

        await makeRequest(SET_YEAR_URL, VIEW_PRODUCTS_URL, sessionCookie, 'post', setYearData);

        const targetUrl = `http://clustersme.ppaos.com/?option=cluster&menu=viewchain&sub=product&id=${vcId}`;
        const response = await makeRequest(targetUrl, VIEW_PRODUCTS_URL, sessionCookie, 'get');

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

        res.json({ 
            success: true, 
            requestedYear: year,
            vcId: vcId,
            data: tableData 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /get-full-chain-data
 * Fetches the full OM-VC-Product chain for a specific year.
 * @query {string} username - The username for login.
 * @query {string} password - The password for login.
 * @query {string} year - The year to fetch the full chain data.
 */
router.get('/get-full-chain-data', async (req, res) => {
    try {
         const { username, password, year } = req.query;
        if (!username || !password || !year) {
            return res.status(400).json({ error: 'Missing username, password, or year' });
        }
        const omResponse = await axios.get('http://localhost:5001/scrape/get-om-data?username=clsadmin1&password=212224236&year=2567');
        if (!omResponse.data.success) throw new Error('Failed to fetch OM data');

        const omData = omResponse.data.data;

        const vcRequests = omData.map(om =>
            axios.get(`http://localhost:5001/scrape/get-vc-data-from-om?username=clsadmin1&password=212224236&year=2567&omId=${om.ID}`)
                .then(response => (response.data.success ? response.data.data.map(vc => ({ ...vc, OM_ID: om.ID })) : []))
        );
        const vcData = (await Promise.all(vcRequests)).flat();

        const productRequests = vcData.map(vc =>
            axios.get(`http://localhost:5001/scrape/get-products-by-vc?username=clsadmin1&password=212224236&year=2567&vcId=${vc.ID}`)
                .then(response => (response.data.success ? response.data.data.map(product => ({ ...product, VC_ID: vc.ID, OM_ID: vc.OM_ID })) : []))
        );
        const productData = (await Promise.all(productRequests)).flat();

        res.json({ success: true, data: { OM:omData, VC:vcData, PRODUCT:productData } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;