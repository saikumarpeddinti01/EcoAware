const express = require('express');
const { listDepartments } = require('../controllers/manage.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, authorize('staff', 'management'), listDepartments);

module.exports = router;
