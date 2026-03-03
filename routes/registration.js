/**
 * University Portal System - Registration Period Routes
 * Copyright (c) 2026 Mazen Hossam. All Rights Reserved.
 */

const express = require('express');
const router = express.Router();
const RegistrationPeriod = require('../models/RegistrationPeriod');
const Course = require('../models/Course');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// â”€â”€â”€ Helper: Determine current semester from date â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getCurrentSemesterInfo = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  let semester, academicYear;
  if (month >= 9 && month <= 12) {
    semester = 'Fall';
    academicYear = `${year}-${year + 1}`;
  } else if (month >= 1 && month <= 5) {
    semester = 'Spring';
    academicYear = `${year - 1}-${year}`;
  } else {
    semester = 'Summer';
    academicYear = `${year - 1}-${year}`;
  }
  return { semester, academicYear, year };
};

// GET /api/registration/current-semester
router.get('/current-semester', auth, (req, res) => {
  try {
    res.json({ success: true, data: getCurrentSemesterInfo() });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// GET /api/registration/active â€” active period (all roles)
router.get('/active', auth, async (req, res) => {
  try {
    const now = new Date();
    const period = await RegistrationPeriod.findOne({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    });
    res.json({ success: true, data: period || null });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// GET /api/registration â€” all periods (superadmin only)
router.get('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const periods = await RegistrationPeriod.find().sort({ startDate: -1 });
    res.json({ success: true, data: periods });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// POST /api/registration (superadmin only)
router.post('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, semester, academicYear, startDate, endDate, allowedYears, notes } = req.body;
    if (!name || !semester || !academicYear || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const period = new RegistrationPeriod({
      name, semester, academicYear,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      allowedYears: allowedYears || [1, 2, 3, 4],
      notes: notes || '',
      isActive: false,
    });
    await period.save();
    res.status(201).json({ success: true, data: period });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// PUT /api/registration/:id (superadmin only)
router.put('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, semester, academicYear, startDate, endDate, allowedYears, notes, isActive } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (semester !== undefined) update.semester = semester;
    if (academicYear !== undefined) update.academicYear = academicYear;
    if (startDate !== undefined) update.startDate = new Date(startDate);
    if (endDate !== undefined) update.endDate = new Date(endDate);
    if (allowedYears !== undefined) update.allowedYears = allowedYears;
    if (notes !== undefined) update.notes = notes;
    if (isActive !== undefined) update.isActive = isActive;
    const period = await RegistrationPeriod.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!period) return res.status(404).json({ success: false, message: 'Period not found' });
    res.json({ success: true, data: period });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// PATCH /api/registration/:id/toggle (superadmin only)
router.patch('/:id/toggle', auth, requireSuperAdmin, async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);
    if (!period) return res.status(404).json({ success: false, message: 'Period not found' });
    if (!period.isActive) {
      await RegistrationPeriod.updateMany({ _id: { $ne: period._id } }, { isActive: false });
    }
    period.isActive = !period.isActive;
    await period.save();
    res.json({ success: true, data: period });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// DELETE /api/registration/:id (superadmin only)
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const period = await RegistrationPeriod.findByIdAndDelete(req.params.id);
    if (!period) return res.status(404).json({ success: false, message: 'Period not found' });
    res.json({ success: true, message: 'Period deleted' });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

// GET /api/registration/courses-by-year (superadmin)
router.get('/courses-by-year', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { semester } = req.query;
    const query = semester ? { semester } : {};
    const courses = await Course.find(query).sort({ year: 1, courseCode: 1 });
    const grouped = { 1: [], 2: [], 3: [], 4: [] };
    courses.forEach(c => { if (c.year >= 1 && c.year <= 4) grouped[c.year].push(c); });
    res.json({ success: true, data: grouped, currentSemester: getCurrentSemesterInfo() });
  } catch (err) {
    return sendError(res, 500, 'An error occurred', err);
  }
});

module.exports = router;
module.exports.getCurrentSemesterInfo = getCurrentSemesterInfo;

