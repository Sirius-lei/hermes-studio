import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/memory'

export const memoryRoutes = new Router()

memoryRoutes.get('/api/DiTing/memory', ctrl.get)
memoryRoutes.post('/api/DiTing/memory', ctrl.save)
