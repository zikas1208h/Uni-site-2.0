const jwt = require('jsonwebtoken');
const User = require('../models/User');

const ADMIN_ROLES = ['admin', 'superadmin', 'doctor', 'assistant'];

const isSuperAdmin = (user) => user.role === 'superadmin' || user.role === 'admin';
const isDoctor     = (user) => user.role === 'doctor';
const isAssistant  = (user) => user.role === 'assistant';
const isAnyAdmin   = (user) => ADMIN_ROLES.includes(user.role);

// â”€â”€ Extract effective course ObjectIds from already-populated req.user â”€â”€â”€â”€â”€â”€â”€â”€
// The auth middleware populates assignedCourses, extraCourses, and linkedDoctors
// with their assignedCourses â€” so we can derive effective IDs without a DB call.
const getEffectiveCourseIds = (user) => {
  const { Types } = require('mongoose');
  const map = new Map();
  if (user.role === 'assistant') {
    (user.linkedDoctors || []).forEach(doc =>
      (doc.assignedCourses || []).forEach(c => {
        const id = c._id || c;
        map.set(id.toString(), new Types.ObjectId(id.toString()));
      })
    );
    (user.extraCourses || []).forEach(c => {
      const id = c._id || c;
      map.set(id.toString(), new Types.ObjectId(id.toString()));
    });
  } else {
    (user.assignedCourses || []).forEach(c => {
      const id = c._id || c;
      map.set(id.toString(), new Types.ObjectId(id.toString()));
    });
  }
  return Array.from(map.values());
};

// Core auth
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).populate('assignedCourses', '_id courseCode courseName status credits year semester')
      .populate('extraCourses',    '_id courseCode courseName status credits year semester')
      .populate({ path: 'linkedDoctors', select: 'firstName lastName assignedCourses',
        populate: { path: 'assignedCourses', select: '_id courseCode courseName status credits year semester' } });

    if (!user) return res.status(401).json({ message: 'User not found' });

    // For assistants: compute effective courses from linkedDoctors + extraCourses
    if (user.role === 'assistant') {
      const doctorCourseMap = new Map();
      (user.linkedDoctors || []).forEach(doc => {
        (doc.assignedCourses || []).forEach(c => doctorCourseMap.set(c._id.toString(), c));
      });
      // Always merge extraCourses, even if no linked doctors
      (user.extraCourses || []).forEach(c => doctorCourseMap.set(c._id.toString(), c));
      user.assignedCourses = Array.from(doctorCourseMap.values());
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Any admin role
const isAdmin = (req, res, next) => {
  if (!isAnyAdmin(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Superadmin only
const requireSuperAdmin = (req, res, next) => {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  next();
};

// Doctor or superadmin
const requireDoctorOrAbove = (req, res, next) => {
  if (isSuperAdmin(req.user) || isDoctor(req.user)) return next();
  return res.status(403).json({ message: 'Doctor or higher access required' });
};

// Any staff
const requireStaff = (req, res, next) => {
  if (isAnyAdmin(req.user)) return next();
  return res.status(403).json({ message: 'Staff access required' });
};

// Doctor/assistant course-level access check
const requireCourseAccess = async (req, res, next) => {
  try {
    if (isSuperAdmin(req.user)) return next();
    const courseId = req.params.courseId || req.params.id || req.body.course;
    if (!courseId) return res.status(400).json({ message: 'Course ID required' });
    const assigned = (req.user.assignedCourses || []).map(c => (c._id || c).toString());
    if (!assigned.includes(courseId.toString())) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: 'An error occurred' });
  }
};

module.exports = {
  auth,
  isAdmin,
  requireSuperAdmin,
  requireDoctorOrAbove,
  requireStaff,
  requireCourseAccess,
  isSuperAdmin,
  isDoctor,
  isAssistant,
  isAnyAdmin,
  getEffectiveCourseIds,
};
