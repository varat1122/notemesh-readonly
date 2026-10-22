import json
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.engine import Engine

from investment_os.api.settings import Settings
from investment_os.domain.entities import EntityEnvelope
from investment_os.policy.access import DUMMY_PRINCIPALS, PermissionRequest, Principal, authorize
from investment_os.storage.database import make_engine, ready

logger = logging.getLogger("investment_os.requests")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
bearer = HTTPBearer(auto_error=False)


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    config = settings or Settings()
    database = engine or make_engine(config.database_url.get_secret_value())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        database.dispose()

    app = FastAPI(title="Investment OS P0 — synthetic only", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def audit_request(request: Request, call_next):
        request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        # Do not log URL/query, body, authorization header, or exception text.
        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "method": request.method,
                    "route": getattr(request.scope.get("route"), "path", "unmatched"),
                    "status": response.status_code,
                }
            )
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # FastAPI normally includes submitted values in validation errors.
        return JSONResponse(status_code=422, content={"detail": "contract validation failed"})

    def principal(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Principal:
        if not config.enable_dummy_auth:
            raise HTTPException(
                401, "authentication disabled in P0", headers={"WWW-Authenticate": "Bearer"}
            )
        actor = DUMMY_PRINCIPALS.get(credentials.credentials) if credentials else None
        if actor is None:
            raise HTTPException(
                401, "invalid synthetic credential", headers={"WWW-Authenticate": "Bearer"}
            )
        return actor

    @app.get("/health/live")
    def live():
        return {"status": "live", "phase": "P0", "synthetic_only": True}

    @app.get("/health/ready")
    def readiness():
        try:
            if ready(database):
                return {"status": "ready", "database": "connected", "migration": "0001_p0"}
        except Exception:
            pass
        raise HTTPException(503, "database or migration not ready")

    @app.post("/v1/contracts/validate")
    def validate(payload: EntityEnvelope, actor: Principal = Depends(principal)):
        return {"valid": True, "kind": payload.root.kind, "id": payload.root.id, "persisted": False}

    @app.post("/v1/policy/evaluate")
    def evaluate(payload: PermissionRequest, actor: Principal = Depends(principal)):
        try:
            authorize(actor, payload)
        except PermissionError:
            raise HTTPException(403, "operation outside P0 scope") from None
        return {
            "permitted_for_future_implementation": True,
            "executed": False,
            "approval_granted": False,
        }

    return app


app = create_app()
