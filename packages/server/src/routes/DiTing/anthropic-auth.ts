import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/anthropic-auth'

export const anthropicAuthRoutes = new Router()

anthropicAuthRoutes.post('/api/DiTing/auth/anthropic/start', ctrl.start)
anthropicAuthRoutes.post('/api/DiTing/auth/anthropic/submit/:sessionId', ctrl.submit)
anthropicAuthRoutes.get('/api/DiTing/auth/anthropic/status', ctrl.status)
