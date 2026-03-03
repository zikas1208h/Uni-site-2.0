const express = require('express');
const router = express.Router();
const multer = require('multer');
const Material = require('../models/Material');
const Course = require('../models/Course');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// Configure multer for memory storage (works on Vercel serverless)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// â”€â”€ Helper â€” uses req.user already populated by auth middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes((courseId?._id || courseId)?.toString());
};

// â”€â”€ All materials (admin/staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/all', auth, isAdmin, async (req, res) => {
  try {
    let query = {};
    if (!isSuperAdmin(req.user)) {
      // Use req.user already populated by auth middleware â€” no extra DB call
      const ids = getEffectiveCourseIds(req.user);
      if (ids.length === 0) return res.json([]);
      query.course = { $in: ids };
    }

    const materials = await Material.find(query)
      .populate('course', 'courseCode courseName')
      .populate('uploadedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    res.json(materials);
  } catch (error) {
    return sendError(res, 500, 'Error fetching materials', error);
  }
});

// â”€â”€ Materials for a course (enrolled students + staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/course/:courseId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const isEnrolled = user.enrolledCourses.map(id => id.toString()).includes(req.params.courseId);

    if (!isEnrolled && !['admin', 'superadmin', 'doctor', 'assistant'].includes(user.role)) {
      return res.status(403).json({ message: 'Not enrolled in this course' });
    }

    const materials = await Material.find({ course: req.params.courseId })
      .populate('course', 'courseCode courseName')
      .sort({ createdAt: -1 });

    res.json(materials);
  } catch (error) {
    return sendError(res, 500, 'Error fetching materials', error);
  }
});

// â”€â”€ My materials (student) â€” MUST be before /:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Download material â€” MUST be before /:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/download/:id', auth, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id).select('+fileData +fileMimeType +fileName');
    if (!material) return res.status(404).json({ message: 'Material not found' });
    if (!material.fileData) return res.status(404).json({ message: 'File data not found.' });

    const buffer = Buffer.from(material.fileData, 'base64');
    const mimeType = material.fileMimeType || 'application/octet-stream';
    const fileName = material.fileName || 'download';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    return sendError(res, 500, 'Error downloading file', error);
  }
});

// â”€â”€ Material by ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Upload material (doctor/assistant/superadmin â€” only assigned courses) â”€â”€â”€â”€â”€â”€â”€
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

    const fileData = req.file.buffer.toString('base64');
    const material = new Material({
      course, title, description, type,
      fileName: req.file.originalname,
      filePath: `uploads/${Date.now()}-${req.file.originalname}`,
      fileSize: req.file.size,
      fileData,
      fileMimeType: req.file.mimetype,
      uploadedBy: uploadedBy || req.userId,
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

// â”€â”€ Update material â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Delete material (doctor â€” own courses; superadmin â€” all) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });
    if (!canAccessCourse(req, material.course)) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }

    await Material.findByIdAndDelete(req.params.id);
    res.json({ message: 'Material deleted successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting material', error);
  }
});

module.exports = router;
