import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/nous-auth'

export const nousAuthRoutes = new Router()

nousAuthRoutes.post('/api/DiTing/auth/nous/start', ctrl.start)
nousAuthRoutes.get('/api/DiTing/auth/nous/poll/:sessionId', ctrl.poll)
nousAuthRoutes.get('/api/DiTing/auth/nous/status', ctrl.status)
