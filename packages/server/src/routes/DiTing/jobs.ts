import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/jobs'

export const jobRoutes = new Router()

jobRoutes.get('/api/DiTing/jobs', ctrl.list)
jobRoutes.get('/api/DiTing/jobs/:id', ctrl.get)
jobRoutes.post('/api/DiTing/jobs', ctrl.create)
jobRoutes.patch('/api/DiTing/jobs/:id', ctrl.update)
jobRoutes.delete('/api/DiTing/jobs/:id', ctrl.remove)
jobRoutes.post('/api/DiTing/jobs/:id/pause', ctrl.pause)
jobRoutes.post('/api/DiTing/jobs/:id/resume', ctrl.resume)
jobRoutes.post('/api/DiTing/jobs/:id/run', ctrl.run)
