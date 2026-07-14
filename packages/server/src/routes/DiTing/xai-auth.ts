import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/xai-auth'

export const xaiAuthRoutes = new Router()

xaiAuthRoutes.post('/api/DiTing/auth/xai/start', ctrl.start)
xaiAuthRoutes.get('/api/DiTing/auth/xai/poll/:sessionId', ctrl.poll)
xaiAuthRoutes.get('/api/DiTing/auth/xai/status', ctrl.status)
