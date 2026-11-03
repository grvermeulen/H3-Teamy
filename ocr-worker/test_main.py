from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from main import app, decode_image_bytes


def _png_bytes(width: int = 24, height: int = 12, blue: int = 200) -> bytes:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:, :, 0] = blue
    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return encoded.tobytes()


def _jpeg_bytes(width: int = 16, height: int = 8) -> bytes:
    img = np.full((height, width, 3), 128, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", img)
    assert ok
    return encoded.tobytes()


class TestDecodeImageBytes:
    def test_decodes_png_with_color_channels(self):
        decoded = decode_image_bytes(_png_bytes())
        assert decoded is not None
        assert decoded.ndim == 3
        assert decoded.shape[2] == 3
        assert decoded.dtype == np.uint8

    def test_decodes_jpeg(self):
        decoded = decode_image_bytes(_jpeg_bytes())
        assert decoded is not None
        assert decoded.shape == (8, 16, 3)

    def test_returns_none_for_invalid_bytes(self):
        assert decode_image_bytes(b"not-an-image") is None

    def test_preserves_pixel_values_after_roundtrip(self):
        source = np.array([[[10, 20, 30]]], dtype=np.uint8)
        ok, encoded = cv2.imencode(".png", source)
        assert ok
        decoded = decode_image_bytes(encoded.tobytes())
        assert decoded is not None
        assert decoded.shape == (1, 1, 3)
        assert tuple(decoded[0, 0]) == (10, 20, 30)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WORKER_TOKEN", "test-token")
    return TestClient(app)


class TestOcrEndpoint:
    def test_rejects_missing_bearer_token(self, client: TestClient):
        response = client.post("/ocr", files={"image": ("x.png", _png_bytes(), "image/png")})
        assert response.status_code == 401

    def test_rejects_invalid_token(self, client: TestClient):
        response = client.post(
            "/ocr",
            files={"image": ("x.png", _png_bytes(), "image/png")},
            headers={"Authorization": "Bearer wrong"},
        )
        assert response.status_code == 403

    def test_rejects_invalid_image_payload(self, client: TestClient):
        response = client.post(
            "/ocr",
            files={"image": ("x.png", b"not-an-image", "image/png")},
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "invalid_image"

    @patch("main._init_reader")
    def test_runs_ocr_on_decoded_image(self, mock_init_reader: MagicMock, client: TestClient):
        reader = MagicMock()
        reader.readtext.return_value = ["H3", "2 - 1"]
        mock_init_reader.return_value = reader

        response = client.post(
            "/ocr",
            files={"image": ("score.png", _png_bytes(), "image/png")},
            headers={"Authorization": "Bearer test-token"},
        )

        assert response.status_code == 200
        assert response.json() == {"raw_text": "H3\n2 - 1", "result": None}
        reader.readtext.assert_called_once()
        img_arg = reader.readtext.call_args.args[0]
        assert isinstance(img_arg, np.ndarray)
        assert img_arg.ndim == 3 and img_arg.shape[2] == 3


class TestHealthEndpoint:
    @patch("main._init_reader")
    def test_health_ok_when_reader_initializes(self, mock_init_reader: MagicMock, client: TestClient):
        mock_init_reader.return_value = MagicMock()
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "reader": True}
