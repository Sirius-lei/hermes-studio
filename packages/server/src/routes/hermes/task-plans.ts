import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/task-plans'

export const taskPlanRoutes = new Router()

taskPlanRoutes.get('/api/hermes/task-plans', ctrl.list)
taskPlanRoutes.get('/api/hermes/task-plans/:id', ctrl.get)
taskPlanRoutes.post('/api/hermes/task-plans/generate', ctrl.generate)
taskPlanRoutes.put('/api/hermes/task-plans/:id', ctrl.update)
taskPlanRoutes.delete('/api/hermes/task-plans/:id', ctrl.remove)
taskPlanRoutes.post('/api/hermes/task-plans/:id/export-kanban', ctrl.exportKanban)
