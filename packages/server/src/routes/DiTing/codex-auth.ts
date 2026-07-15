import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/codex-auth'

export const codexAuthRoutes = new Router()

codexAuthRoutes.post('/api/DiTing/auth/codex/start', ctrl.start)
codexAuthRoutes.get('/api/DiTing/auth/codex/poll/:sessionId', ctrl.poll)
codexAuthRoutes.get('/api/DiTing/auth/codex/status', ctrl.status)
