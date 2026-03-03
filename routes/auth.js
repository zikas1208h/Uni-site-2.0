const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { auth, requireSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
// mailer is lazy-loaded only in send-otp — never on login path
const getMailer = () => require('../utils/mailer');

// â”€â”€ Helper: compute effective assignedCourses for a staff member â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const computeEffectiveCourses = (staffMember) => {
  if (staffMember.role === 'assistant') {
    const courseMap = new Map();
    // Merge linked doctors' courses
    (staffMember.linkedDoctors || []).forEach(doc => {
      (doc.assignedCourses || []).forEach(c => courseMap.set(c._id.toString(), c));
    });
    // Merge extra courses (these should always be included, even with no linked doctors)
    (staffMember.extraCourses || []).forEach(c => courseMap.set(c._id.toString(), c));
    staffMember.assignedCourses = Array.from(courseMap.values());
  }
  return staffMember;
};

// â”€â”€ Register (students self-register) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/register', async (req, res) => {
  try {
    const { studentId, email, password, firstName, lastName, major, year } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { studentId }] });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ studentId, email, password: hashedPassword, firstName, lastName, major, year });
    await user.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error registering user', error);
  }
});

// â”€â”€ Login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Step 1: fast lookup — only fetch password + role first
    const userRaw = await User.findOne({ email }).select('password role mustChangeCredentials').lean();
    if (!userRaw) return res.status(401).json({ message: 'Invalid credentials' });

    const isValidPassword = await bcrypt.compare(password, userRaw.password);
    if (!isValidPassword) return res.status(401).json({ message: 'Invalid credentials' });

    const isStaff = ['admin','superadmin','doctor','assistant'].includes(userRaw.role);

    // Step 2: only do heavy populate for staff; students get a lean fetch
    let user;
    if (isStaff) {
      user = await User.findById(userRaw._id)
        .populate('assignedCourses', 'courseCode courseName _id status credits year semester')
        .populate('extraCourses',    'courseCode courseName _id status credits year semester')
        .populate({ path: 'linkedDoctors', select: 'firstName lastName _id assignedCourses',
          populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } })
        .lean();
    } else {
      user = await User.findById(userRaw._id).select('-password').lean();
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    let effectiveCourses = user.assignedCourses || [];
    if (user.role === 'assistant') {
      const courseMap = new Map();
      (user.linkedDoctors || []).forEach(doc => {
        (doc.assignedCourses || []).forEach(c => courseMap.set(c._id.toString(), c));
      });
      (user.extraCourses || []).forEach(c => courseMap.set(c._id.toString(), c));
      effectiveCourses = Array.from(courseMap.values());
    }

    res.json({
      token,
      user: {
        id: user._id,
        studentId: user.studentId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        major: user.major,
        year: user.year,
        role: user.role,
        assignedCourses: effectiveCourses,
        permissions: user.permissions || {},
        profilePicture: user.profilePicture || null,
        mustChangeCredentials: user.mustChangeCredentials || false,
      }
    });
  } catch (error) {
    return sendError(res, 500, 'Error logging in', error);
  }
});

// â”€â”€ Get current user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password')
      .populate('assignedCourses', 'courseCode courseName _id status credits year semester')
      .populate('extraCourses',    'courseCode courseName _id status credits year semester')
      .populate({ path: 'linkedDoctors', select: 'firstName lastName _id assignedCourses',
        populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } })
      .lean();

    if (!user) return res.status(401).json({ message: 'User not found' });
    computeEffectiveCourses(user);
    res.json(user);
  } catch (error) {
    return sendError(res, 500, 'Error getting user', error);
  }
});


// â”€â”€ Get all staff (superadmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/staff', auth, requireSuperAdmin, async (req, res) => {
  try {
    const staffList = await User.find({ role: { $in: ['admin', 'superadmin', 'doctor', 'assistant'] } })
      .select('-password')
      .populate('assignedCourses', 'courseCode courseName _id status credits year semester')
      .populate('extraCourses',    'courseCode courseName _id status credits year semester')
      .populate({ path: 'linkedDoctors', select: 'firstName lastName _id assignedCourses',
        populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } })
      .sort({ role: 1, lastName: 1 });

    const result = staffList.map(s => {
      const obj = s.toObject();
      computeEffectiveCourses(obj);
      return obj;
    });
    res.json({ success: true, data: result });
  } catch (error) {
    return sendError(res, 500, 'Error fetching staff', error);
  }
});

// â”€â”€ Create staff account (superadmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/staff', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { studentId, email, password, firstName, lastName, major, year, role, assignedCourses, linkedDoctors, extraCourses, permissions } = req.body;

    const STAFF_ROLES = ['doctor', 'assistant', 'superadmin'];
    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid staff role. Use doctor, assistant, or superadmin.' });
    }

    const existing = await User.findOne({ $or: [{ email }, { studentId }] });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists with that email or ID' });

    const hashedPassword = await bcrypt.hash(password || 'HNU@2026', 10);
    const staff = new User({
      studentId, email, password: hashedPassword,
      firstName, lastName,
      major: major || 'Staff',
      year: year || 1,
      role,
      assignedCourses: role === 'assistant' ? [] : (assignedCourses || []),
      linkedDoctors:   role === 'assistant' ? (linkedDoctors || []) : [],
      extraCourses:    role === 'assistant' ? (extraCourses || []) : [],
      permissions:     role === 'superadmin' ? {} : (permissions || {}),
      mustChangeCredentials: true,  // force credential setup on first login
    });
    await staff.save();

    const populated = await User.findById(staff._id).select('-password')
      .populate('assignedCourses', 'courseCode courseName _id status credits year semester')
      .populate('extraCourses',    'courseCode courseName _id status credits year semester')
      .populate({ path: 'linkedDoctors', select: 'firstName lastName _id assignedCourses',
        populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } });

    const obj = populated.toObject();
    computeEffectiveCourses(obj);
    res.status(201).json({ success: true, data: obj });
  } catch (error) {
    return sendError(res, 500, 'Error creating staff', error);
  }
});

// â”€â”€ Semester reset: unlink all assistants from doctors (superadmin only) â”€â”€â”€â”€â”€â”€
// MUST be before /:id routes so Express doesn't treat 'semester-reset' as an ID
router.post('/staff/semester-reset', auth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { role: 'assistant' },
      { $set: { linkedDoctors: [], extraCourses: [], assignedCourses: [] } }
    );
    res.json({ success: true, message: `Reset ${result.modifiedCount} assistant(s) â€” all doctor links cleared for new semester.` });
  } catch (error) {
    return sendError(res, 500, 'Error resetting semester', error);
  }
});

// â”€â”€ Update staff account (superadmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/staff/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, role, assignedCourses, linkedDoctors, extraCourses, password, permissions } = req.body;

    const update = {};
    if (firstName)  update.firstName = firstName;
    if (lastName)   update.lastName  = lastName;
    if (email)      update.email     = email;
    if (role)       update.role      = role;
    if (password)   update.password  = await bcrypt.hash(password, 10);
    if (permissions !== undefined && role !== 'superadmin') update.permissions = permissions;

    // For assistants: save linkedDoctors + extraCourses; assignedCourses computed live
    const targetRole = role || (await User.findById(req.params.id).select('role'))?.role;
    if (targetRole === 'assistant') {
      if (linkedDoctors !== undefined) update.linkedDoctors = linkedDoctors;
      // extraCourses must only contain raw ObjectId strings (24 hex chars), never the computed effective list
      if (extraCourses !== undefined) {
        const mongoose = require('mongoose');
        update.extraCourses = extraCourses.filter(id => mongoose.Types.ObjectId.isValid(id));
      }
      update.assignedCourses = []; // always cleared â€” recomputed dynamically on every request
    } else {
      if (assignedCourses !== undefined) update.assignedCourses = assignedCourses;
      update.linkedDoctors = [];
      update.extraCourses  = [];
    }

    const staff = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select('-password')
      .populate('assignedCourses', 'courseCode courseName _id status credits year semester')
      .populate('extraCourses',    'courseCode courseName _id status credits year semester')
      .populate({ path: 'linkedDoctors', select: 'firstName lastName _id assignedCourses',
        populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } });

    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found' });
    const obj = staff.toObject();
    computeEffectiveCourses(obj);
    res.json({ success: true, data: obj });
  } catch (error) {
    return sendError(res, 500, 'Error updating staff', error);
  }
});

// â”€â”€ Delete staff account (superadmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/staff/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.userId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    const staff = await User.findByIdAndDelete(req.params.id);
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found' });
    res.json({ success: true, message: 'Staff member deleted' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting staff', error);
  }
});

// ── POST /auth/send-otp  ─────────────────────────────────────────────────────
// Staff: during first-login flow, send a 6-digit OTP to the NEW email they typed
router.post('/send-otp', auth, async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Check no other account already owns that email
    const conflict = await User.findOne({ email: newEmail, _id: { $ne: req.userId } });
    if (conflict) return res.status(409).json({ message: 'That email is already registered to another account.' });

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    user.otp      = await bcrypt.hash(otp, 8);
    user.otpExpiry = otpExpiry;
    await user.save();

    await getMailer().sendOtpEmail(newEmail, user.firstName, otp);

    res.json({ message: `Verification code sent to ${newEmail}. Check your inbox.` });
  } catch (e) {
    console.error('send-otp error:', e.message);
    return sendError(res, 500, 'Failed to send verification email. Check SMTP settings.', e);
  }
});

// ── POST /auth/verify-otp  ───────────────────────────────────────────────────
// Staff: verify the OTP code they received (does NOT change anything yet)
router.post('/verify-otp', auth, async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ message: 'OTP code is required.' });

    const user = await User.findById(req.userId);
    if (!user || !user.otp || !user.otpExpiry) {
      return res.status(400).json({ message: 'No pending OTP. Please request a new code.' });
    }
    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
    }

    const match = await bcrypt.compare(otp, user.otp);
    if (!match) return res.status(400).json({ message: 'Incorrect code. Please try again.' });

    // Issue a short-lived "otp-verified" token so setup-credentials can trust the call
    const verifyToken = jwt.sign(
      { userId: user._id, otpVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ message: 'Email verified!', verifyToken });
  } catch (e) {
    return sendError(res, 500, 'Error verifying OTP', e);
  }
});

// ── POST /auth/setup-credentials  ───────────────────────────────────────────
// Staff: final step — sets the new email + new password, clears mustChangeCredentials
router.post('/setup-credentials', auth, async (req, res) => {
  try {
    const { newEmail, newPassword, verifyToken } = req.body;

    if (!newEmail || !newPassword || !verifyToken) {
      return res.status(400).json({ message: 'newEmail, newPassword, and verifyToken are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    // Validate the OTP-verified token
    let decoded;
    try {
      decoded = jwt.verify(verifyToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Verification token is invalid or expired. Please restart.' });
    }
    if (!decoded.otpVerified || decoded.userId.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Token mismatch. Please restart the setup process.' });
    }

    // Final conflict check
    const conflict = await User.findOne({ email: newEmail, _id: { $ne: req.userId } });
    if (conflict) return res.status(409).json({ message: 'That email is already in use.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        email: newEmail,
        password: hashed,
        mustChangeCredentials: false,
        otp: null,
        otpExpiry: null,
      },
      { new: true }
    ).select('-password').populate('assignedCourses', 'courseCode courseName _id status credits year semester');

    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Issue a fresh JWT with the updated user
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Credentials updated successfully!',
      token,
      user: {
        id: user._id,
        studentId: user.studentId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        major: user.major,
        year: user.year,
        role: user.role,
        assignedCourses: user.assignedCourses || [],
        permissions: user.permissions || {},
        profilePicture: user.profilePicture || null,
        mustChangeCredentials: false,
      },
    });
  } catch (e) {
    return sendError(res, 500, 'Error setting up credentials', e);
  }
});

module.exports = router;
