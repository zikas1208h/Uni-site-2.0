const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const multer = require('multer');
const { sendError } = require('../utils/errorResponse');
const { uploadToCloudinary, isCloudinaryConfigured } = require('../utils/cloudinary');

// Use memory storage â€” Vercel has no writable filesystem
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// Change own password (any authenticated user)
router.post('/profile/change-password', auth, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Current and new password are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'New password must be at least 6 characters' });

    const user = await User.findById(req.userId);
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match)
      return res.status(400).json({ message: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error changing password', error);
  }
});

// Get student profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password')
      .populate('enrolledCourses');
    res.json(user);
  } catch (error) {
    return sendError(res, 500, 'Error fetching profile', error);
  }
});

// Update student profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, major, year } = req.body;
    const user = await User.findByIdAndUpdate(
      req.userId,
      { firstName, lastName, major, year },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (error) {
    return sendError(res, 500, 'Error updating profile', error);
  }
});

// Upload profile picture — Cloudinary if configured, base64 fallback for dev
router.post('/profile/picture', auth, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let profilePicture;
    if (isCloudinaryConfigured()) {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'profile-pictures',
        filename: `${req.userId}_${Date.now()}.jpg`,
        mimetype: req.file.mimetype,
      });
      profilePicture = result.url; // Clean Cloudinary URL — NOT a 50KB base64 string
    } else {
      // Dev fallback
      profilePicture = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture },
      { new: true }
    ).select('-password');
    res.json({ message: 'Profile picture updated', profilePicture, user });
  } catch (error) {
    return sendError(res, 500, 'Error uploading picture', error);
  }
});

// Get all students (staff: superadmin sees all; doctor/assistant sees students in their courses)
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const SELECT   = '-password -profilePicture';
    const POPULATE = { path: 'enrolledCourses', select: 'courseCode courseName _id credits year semester' };

    const canSeeAll = isSuperAdmin(req.user) || req.user.permissions?.canViewAllStudents === true;

    if (canSeeAll) {
      const students = await User.find({ role: 'student' }).select(SELECT).populate(POPULATE).lean();
      return res.json(students);
    }

    // Use already-populated req.user â€” no extra DB round-trip
    const assignedObjectIds = getEffectiveCourseIds(req.user);
    if (assignedObjectIds.length === 0) return res.json([]);

    const Grade = require('../models/Grade');
    const [enrolledStudents, gradedStudentIds] = await Promise.all([
      User.find({ role: 'student', enrolledCourses: { $in: assignedObjectIds } })
          .select(SELECT).populate(POPULATE).lean(),
      Grade.distinct('student', { course: { $in: assignedObjectIds } }),
    ]);

    const gradedStudents = gradedStudentIds.length > 0
      ? await User.find({ role: 'student', _id: { $in: gradedStudentIds } })
          .select(SELECT).populate(POPULATE).lean()
      : [];

    const seen = new Set();
    const students = [...enrolledStudents, ...gradedStudents].filter(s => {
      const id = s._id.toString();
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });

    res.json(students);
  } catch (error) {
    return sendError(res, 500, 'Error fetching students', error);
  }
});

// Get student by ID (staff) â€” full data including profilePicture
router.get('/:id', auth, isAdmin, async (req, res) => {
  try {
    const student = await User.findById(req.params.id)
      .select('-password')
      .populate('enrolledCourses', 'courseCode courseName _id credits year semester prerequisites')
      .lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) {
    return sendError(res, 500, 'Error fetching student', error);
  }
});

// Update student info: name, group, section (admin/doctor)
router.put('/:id', auth, isAdmin, async (req, res) => {
  try {
    const { firstName, lastName, lectureGroup, section } = req.body;
    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName  !== undefined) updates.lastName  = lastName;
    if (lectureGroup !== undefined) updates.lectureGroup = parseInt(lectureGroup);
    if (section      !== undefined) updates.section      = parseInt(section);

    const student = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
      .select('-password')
      .populate('enrolledCourses', 'courseCode courseName _id credits year semester prerequisites')
      .lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) {
    return sendError(res, 500, 'Error updating student', error);
  }
});

// Add course to student (admin/doctor)
router.post('/:id/courses/:courseId', auth, isAdmin, async (req, res) => {
  try {
    const Course = require('../models/Course');
    const [student, course] = await Promise.all([
      User.findById(req.params.id),
      Course.findById(req.params.courseId)
    ]);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!course)  return res.status(404).json({ message: 'Course not found' });

    // â”€â”€ Major check: only Shared or matching major â”€â”€
    const courseIsShared = !course.major || course.major === 'Shared' || course.major === 'shared';
    const courseMatchesMajor = course.major === student.major;
    if (!courseIsShared && !courseMatchesMajor) {
      return res.status(403).json({
        message: `This course is for ${course.major} students only. This student is in ${student.major}.`
      });
    }

    if (student.enrolledCourses.map(c => c.toString()).includes(course._id.toString())) {
      return res.status(400).json({ message: 'Student already enrolled in this course' });
    }
    student.enrolledCourses.push(course._id);
    course.enrolledStudents.push(student._id);
    await Promise.all([student.save(), course.save()]);
    const updated = await User.findById(req.params.id)
      .select('-password')
      .populate('enrolledCourses', 'courseCode courseName _id credits year semester prerequisites')
      .lean();
    res.json(updated);
  } catch (error) {
    return sendError(res, 500, 'Error adding course', error);
  }
});

// Remove course from student (admin/doctor)
router.delete('/:id/courses/:courseId', auth, isAdmin, async (req, res) => {
  try {
    const Course = require('../models/Course');
    const [student, course] = await Promise.all([
      User.findById(req.params.id),
      Course.findById(req.params.courseId)
    ]);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!course)  return res.status(404).json({ message: 'Course not found' });

    student.enrolledCourses = student.enrolledCourses.filter(c => c.toString() !== course._id.toString());
    course.enrolledStudents = course.enrolledStudents.filter(s => s.toString() !== student._id.toString());
    await Promise.all([student.save(), course.save()]);
    const updated = await User.findById(req.params.id)
      .select('-password')
      .populate('enrolledCourses', 'courseCode courseName _id credits year semester prerequisites')
      .lean();
    res.json(updated);
  } catch (error) {
    return sendError(res, 500, 'Error removing course', error);
  }
});

// Reset student password (admin only)
router.post('/:id/reset-password', auth, requireSuperAdmin, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const newPassword = req.body.password || 'student123';
    const hashed = await bcrypt.hash(newPassword, 10);
    const student = await User.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true }).select('-password');
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json({ message: `Password reset to "${newPassword}" successfully` });
  } catch (error) {
    return sendError(res, 500, 'Error resetting password', error);
  }
});

module.exports = router;

