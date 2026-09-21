const express = require('express');
const ctrl = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Everything here is management-only.
router.use(authenticate, authorize('management'));

router.post('/', ctrl.createUser);
router.get('/', ctrl.listUsers);

module.exports = router;
