import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/task-plans'

export const taskPlanRoutes = new Router()

taskPlanRoutes.get('/api/DiTing/task-plans', ctrl.list)
taskPlanRoutes.get('/api/DiTing/task-plans/:id', ctrl.get)
taskPlanRoutes.post('/api/DiTing/task-plans/generate', ctrl.generate)
taskPlanRoutes.put('/api/DiTing/task-plans/:id', ctrl.update)
taskPlanRoutes.delete('/api/DiTing/task-plans/:id', ctrl.remove)
taskPlanRoutes.post('/api/DiTing/task-plans/:id/export-kanban', ctrl.exportKanban)
