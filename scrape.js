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


module.exports = router;