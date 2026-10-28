"""Regression tests for the pinned PyTorch / EasyOCR stack (import ABI and CPU forwards)."""

import torch


class TestTorchStackImports:
    def test_torch_import_and_version(self):
        import torch as torch_mod

        assert torch_mod.__version__.startswith("2.15")

    def test_torchvision_import(self):
        import torchvision

        assert torchvision.__version__

    def test_torchaudio_import(self):
        import torchaudio

        assert torchaudio.__version__.startswith("2.11")

    def test_easyocr_import(self):
        import easyocr

        assert easyocr.__version__ == "1.7.2"


class TestTorchCpuOps:
    def test_conv2d_forward(self):
        layer = torch.nn.Conv2d(3, 4, kernel_size=3, padding=1)
        layer.eval()
        x = torch.randn(2, 3, 16, 16)
        with torch.no_grad():
            y = layer(x)
        assert y.shape == (2, 4, 16, 16)


class TestTorchvisionCompiledOps:
    def test_nms_runs_on_cpu(self):
        from torchvision.ops import nms

        boxes = torch.tensor(
            [[0.0, 0.0, 10.0, 10.0], [1.0, 1.0, 11.0, 11.0]],
            dtype=torch.float32,
        )
        scores = torch.tensor([0.9, 0.8], dtype=torch.float32)
        keep = nms(boxes, scores, 0.5)
        assert keep.dtype == torch.int64
        assert keep.numel() >= 1


class TestEasyocrModelForward:
    def test_craft_detection_forward_without_pretrained_weights(self):
        from easyocr.craft import CRAFT

        net = CRAFT(pretrained=False, freeze=False)
        net.eval()
        x = torch.randn(1, 3, 64, 64)
        with torch.no_grad():
            score_map, feature = net(x)
        assert score_map.shape == (1, 32, 32, 2)
        assert feature.ndim == 4

    def test_recognition_model_forward_with_random_weights(self):
        from easyocr.model.model import Model

        model = Model(
            input_channel=1,
            output_channel=512,
            hidden_size=256,
            num_class=37,
        )
        model.eval()
        image = torch.randn(1, 1, 32, 100)
        text = torch.zeros(1, 1, dtype=torch.long)
        with torch.no_grad():
            prediction = model(image, text)
        assert prediction.shape[0] == 1
        assert prediction.shape[-1] == 37
