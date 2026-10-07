const { z } = require("zod");

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  status: z.enum(["pending", "in_progress", "completed"]).default("pending"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  category: z.string().trim().min(1).max(60).default("General"),
  dueDate: z.union([z.string().date(), z.literal("")]).nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional()
};

const taskCreateSchema = z.object(taskFields).strict();
const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  dueDate: z.union([z.string().date(), z.literal("")]).nullable().optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one field is required.");

const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const authSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128)
}).strict();

module.exports = { authSchema, taskCreateSchema, taskUpdateSchema };
