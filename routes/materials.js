const express = require('express');
const router = express.Router();
const multer = require('multer');
const Material = require('../models/Material');
const Course = require('../models/Course');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const { uploadToCloudinary, deleteFromCloudinary, isCloudinaryConfigured } = require('../utils/cloudinary');

// Configure multer for memory storage (works on Vercel serverless)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ── Helper ── uses req.user already populated by auth middleware ─────────────────
const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes((courseId?._id || courseId)?.toString());
};

// ── All materials (admin/staff) ─────────────────────────────────────────────────
router.get('/all', auth, isAdmin, async (req, res) => {
  try {
    let query = {};
    if (!isSuperAdmin(req.user)) {
      // Use req.user already populated by auth middleware — no extra DB call
      const ids = getEffectiveCourseIds(req.user);
      if (ids.length === 0) return res.json([]);
      query.course = { $in: ids };
    }

    const materials = await Material.find(query)
      .select('-fileData')
      .populate('course', 'courseCode courseName')
      .populate('uploadedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    res.json(materials);
  } catch (error) {
    return sendError(res, 500, 'Error fetching materials', error);
  }
});

// ── Materials for a course (enrolled students + staff) ─────────────────────────
router.get('/course/:courseId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const isEnrolled = user.enrolledCourses.map(id => id.toString()).includes(req.params.courseId);

    if (!isEnrolled && !['admin', 'superadmin', 'doctor', 'assistant'].includes(user.role)) {
      return res.status(403).json({ message: 'Not enrolled in this course' });
    }

    const materials = await Material.find({ course: req.params.courseId })
      .select('-fileData')
      .populate('course', 'courseCode courseName')
      .sort({ createdAt: -1 });

    res.json(materials);
  } catch (error) {
    return sendError(res, 500, 'Error fetching materials', error);
  }
});

// ── My materials (student) ─────────────────────────────────────────────────────
router.get('/my-materials', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const Grade = require('../models/Grade');
    // Include courses from grades too (same fix as assignments)
    const grades = await Grade.find({ student: req.userId }, { course: 1 }).lean();
    const courseIds = new Set([
      ...(user.enrolledCourses || []).map(id => id.toString()),
      ...grades.map(g => g.course.toString()),
    ]);
    const materials = await Material.find({ course: { $in: Array.from(courseIds) } })
      .populate('course', 'courseCode courseName')
      .sort({ createdAt: -1 })
      .lean();
    res.json(materials);
  } catch (error) {
    return sendError(res, 500, 'Error fetching materials', error);
  }
});

// ── Download material — redirect to Cloudinary or stream legacy base64 ──────
router.get('/download/:id', auth, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id)
      .select('+fileData +fileMimeType +fileName +fileUrl cloudinaryPublicId');
    if (!material) return res.status(404).json({ message: 'Material not found' });

    // NEW: Cloudinary — just redirect, browser handles the download
    if (material.fileUrl && material.fileUrl.startsWith('http')) {
      return res.redirect(302, material.fileUrl);
    }
    // LEGACY: base64 in MongoDB
    if (!material.fileData) return res.status(404).json({ message: 'File data not found.' });
    const buffer = Buffer.from(material.fileData, 'base64');
    res.setHeader('Content-Type', material.fileMimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(material.fileName || 'download')}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    return sendError(res, 500, 'Error downloading file', error);
  }
});

// ── Material by ID ─────────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id).populate('course');
    if (!material) return res.status(404).json({ message: 'Material not found' });

    const user = await User.findById(req.userId);
    const isEnrolled = user.enrolledCourses.map(id => id.toString()).includes(material.course._id.toString());

    if (!isEnrolled && !['admin', 'superadmin', 'doctor', 'assistant'].includes(user.role)) {
      return res.status(403).json({ message: 'Not enrolled in this course' });
    }

    res.json(material);
  } catch (error) {
    return sendError(res, 500, 'Error fetching material', error);
  }
});

// ── Upload material (doctor/assistant/superadmin — only assigned courses) ────────
router.post('/', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { course, title, description, type, uploadedBy } = req.body;

    // Permission check
    if (!isSuperAdmin(req.user) && req.user.permissions?.canUploadMaterials === false) {
      return res.status(403).json({ message: 'You do not have permission to upload materials' });
    }

    if (!canAccessCourse(req, course)) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }

    // NEW: Upload to Cloudinary if configured, else fall back to base64 (dev only)
    let fileUrl = null, cloudinaryPublicId = null, fileData = null;
    if (isCloudinaryConfigured()) {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'materials',
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      fileUrl = result.url;
      cloudinaryPublicId = result.publicId;
    } else {
      // fallback for local dev without Cloudinary credentials
      fileData = req.file.buffer.toString('base64');
    }

    const material = new Material({
      course, title, description, type,
      fileName:           req.file.originalname,
      filePath:           fileUrl || `uploads/${Date.now()}-${req.file.originalname}`,
      fileUrl:            fileUrl,
      cloudinaryPublicId: cloudinaryPublicId,
      fileSize:           req.file.size,
      fileData:           fileData,   // null when Cloudinary used
      fileMimeType:       req.file.mimetype,
      uploadedBy:         uploadedBy || req.userId,
    });
    await material.save();

    // Fan-out notification to enrolled students
    try {
      const courseDoc = await Course.findById(course).select('courseCode courseName enrolledStudents').lean();
      // Collect student IDs from enrolledCourses, Grade records, and Course.enrolledStudents
      const Grade = require('../models/Grade');
      const [enrolledUsers, grades] = await Promise.all([
        User.find({ role: 'student', enrolledCourses: course }, { _id: 1 }).lean(),
        Grade.find({ course }, { student: 1 }).lean(),
      ]);
      const idSet = new Set();
      enrolledUsers.forEach(u => idSet.add(u._id.toString()));
      grades.forEach(g => idSet.add(g.student.toString()));
      (courseDoc?.enrolledStudents || []).forEach(id => idSet.add(id.toString()));

      if (idSet.size && courseDoc) {
        const typeLbl = type === 'assignment' ? 'ًں“‌ Assignment' : type === 'video' ? 'ًںژ¥ Video' : 'ًں“„ Material';
        const docs = Array.from(idSet).map(id => ({
          recipient: id,
          type: 'material',
          title: `${typeLbl} uploaded: ${title}`,
          message: `New ${type} material was uploaded for ${courseDoc.courseCode} â€” ${courseDoc.courseName}.`,
          course: course,
          material: material._id,
        }));
        await Notification.insertMany(docs, { ordered: false });
      }
    } catch (ne) { console.error('Material notification error:', ne.message); }

    const { fileData: _, ...obj } = material.toObject();
    res.status(201).json(obj);
  } catch (error) {
    return sendError(res, 500, 'Error uploading material', error);
  }
});

// ── Update material ───────────────────────────────────────────────────────────
router.put('/:id', auth, isAdmin, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });
    if (!canAccessCourse(req, material.course)) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }
    const updated = await Material.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (error) {
    return sendError(res, 500, 'Error updating material', error);
  }
});

// ── Delete material (doctor — own courses; superadmin — all) ─────────────────
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });
    if (!canAccessCourse(req, material.course)) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }

    await Material.findByIdAndDelete(req.params.id);
    // Clean up Cloudinary asset
    if (material.cloudinaryPublicId) {
      await deleteFromCloudinary(material.cloudinaryPublicId, material.fileMimeType);
    }
    res.json({ message: 'Material deleted successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting material', error);
  }
});

module.exports = router;
