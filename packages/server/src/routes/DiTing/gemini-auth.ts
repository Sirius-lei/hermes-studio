import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/gemini-auth'

export const geminiAuthRoutes = new Router()

geminiAuthRoutes.post('/api/DiTing/auth/gemini/start', ctrl.start)
geminiAuthRoutes.get('/api/DiTing/auth/gemini/poll/:sessionId', ctrl.poll)
geminiAuthRoutes.get('/api/DiTing/auth/gemini/status', ctrl.status)
