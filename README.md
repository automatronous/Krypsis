# PS171: Privacy-Preserving Vision Agent

An **on-device privacy firewall** that safeguards sensitive user data from vision-capable AI browser agents. PS171 operates locally within the browser, inspecting web pages, redacting confidential information, detecting malicious prompt injection attacks, and enforcing strict governance policies over proposed agent actions.

## 🎯 Problem Statement

1. **Server-side agentic AI pipelines** require **visual context** and **screen states** for **complex workflows**, but transmitting unfiltered data exposes **sensitive/PII data**, creating a **privacy vs. reasoning capability trade-off**.

2. **Local systems** lack resources to host **full-fledged pipelines**, necessitating **client-server architecture** with **data privacy** through **sanitization** before **network requests**.

3. **Privacy-preserving filter** must dynamically **detect and redact sensitive elements** with high **accuracy**, balancing **inference latency**, **client-side resource utilization**, and **end-to-end latency**.

## ✨ Innovation & Uniqueness

1. **On-device ViT-based browser agent** with **hardware-adaptive model tiering** and **real-time PII redaction**, combining **local inference** with **privacy-preserving filter** mechanisms beyond static vision agents.

2. **Dual-mode redaction** (bounding-box + semantic obfuscation) optimizing **precision of redaction** and **recall/precision of PII detection**, enabling **accurate visual context** extraction without blanket blurring.

3. **Cross-platform browser deployment** (desktop and mobile) extending **local-first AI** paradigm while maintaining **server-client contract** that decouples **privacy** and **reasoning capability** through **anonymized visual context** processing by powerful VLMs.

## 🏗️ Architecture Overview

### Hardware-Adaptive Model Tiering

PS171 automatically installs one of three **lightweight ViT-based models** during extension setup based on **device capability** to optimize **inference latency** and **client-side resource utilization**:

- **High-Performance Devices:** Full local models including **BlazeFace**, **EasyOCR**, and quantized **SmolVLM ONNX** binary running 100% on-device
- **Standard Devices:** Client-side **BlazeFace** and **EasyOCR** for local visual redaction with cloud fallback for agent planning
- **Low-Power Devices:** Ultra-lightweight **WebGPU/WASM** pipeline combined with **DOM heuristics** to preserve system resources

All model assets are validated against pinned **SHA-256 cryptographic hashes** before storage to prevent tampering.

### Seven-Stage Perception & Redaction Workflow

1. **Screenshot Capture:** Tab screenshot acquisition
2. **DOM Heuristics:** Fast **DOM heuristics** to locate passwords, credit card inputs, and auth tokens
3. **Vision Model Processing:** **Face detection** and **OCR text region extraction** to catch visual PII
4. **Canvas Redaction:** Immediate redaction using:
   - Solid blackouts for secrets
   - Pixelation for text-based PII
   - Heavy blurring for faces
5. **Data Sanitization:** **Sanitized OCR text** and **bounded DOM metadata** extraction
6. **Transmission:** Only fully redacted screenshot with **anonymized, unidentifiable data** transmitted
7. **VLM Planning:** **Central server** processes **sanitized payload** and returns **actionable commands**

### Deterministic Policy Engine

Proposed browser actions must pass through PS171's **deterministic policy engine** before execution:

- ✅ **Safe Operations:** Reading, scrolling allowed automatically
- 🔒 **Form-Filling:** Sensitive data sanitized before submission
- ⚠️ **High-Risk Operations:** Account modifications, checkout actions trigger explicit user confirmation
- 🚫 **Dangerous Exploits:** Injection attacks blocked entirely

## 📊 Impact

1. **Redefining AI Trust:** Eliminates privacy vs. capability trade-off by ensuring **sensitive/PII data** never reaches **third-party servers** while maintaining **advanced AI capabilities**.

2. **Unlocking Enterprise Automation:** Enables safe **agentic AI pipeline** deployment across **regulated environments** for **complex workflows** without **data leakage** risk.

3. **Decentralizing Perception:** Shifts **visual intelligence** to **local browser**, proving **privacy-preserving filter** operates effectively on **edge devices**.

## 🎁 Key Benefits

1. **Zero Data Exposure & Performance:** **Detects and redacts sensitive elements** locally, transmitting only **anonymized data** with low **end-to-end latency** and **client-side resource utilization**.

2. **High Fidelity Execution:** Achieves high **accuracy of visual context** enabling **central server** to interpret **sanitized payload** and return **actionable commands**.

3. **Uncompromised Accuracy:** Delivers state-of-the-art **recall and precision for PII detection** with strict **precision of redaction**.

## 🔧 Key Feasibility Features

• **Device-Aware Inference:** Hardware-adaptive model tiering, client-side resource utilization, end-to-end latency, device capability

• **Hybrid Perception:** Rules-based + lightweight ML, accuracy of visual context, recall and precision for PII detection

• **Local Execution:** WebGPU/WASM, local browser, screen states, no raw data transmission

• **Privacy Wall:** Privacy-preserving filter, sensitive/PII data, sanitization, precision of redaction

• **Lightweight Models:** SmolVLM, local models, VLM planner, reasoning power, data privacy

## ✅ Key Viability Features

• **Scalable:** Adapts **agentic AI pipelines** across devices while enforcing **privacy-preserving filter** and **high precision of redaction**

• **Resource Efficient:** Minimizes **client-side resource utilization** and **end-to-end latency** by prioritizing **DOM heuristics** before invoking **local vision models**

• **Offline Capable:** Evaluates **screen states** locally to dynamically **detect and redact sensitive elements** (passwords, PII, faces) without **network requests**

• **Cost Efficient:** Transmits only **anonymized, unidentifiable data** to **server-side**, lowering **cloud compute overhead** while returning **actionable commands** for task automation

## 🚀 Getting Started

### Prerequisites

- Chrome or Firefox browser with WebGPU support
- Node.js 16+ for development
- Python 3.8+ for server-side deployment

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ps171.git
cd ps171
```

2. Install client-side dependencies:
```bash
cd client
npm install
```

3. Build the browser extension:
```bash
npm run build
```

4. Load the extension in your browser:
   - **Chrome:** Navigate to `chrome://extensions/` → Enable "Developer mode" → Load unpacked → Select `dist/` folder
   - **Firefox:** Navigate to `about:debugging` → This Firefox → Load Temporary Add-on → Select `dist/manifest.json`

5. Set up server-side:
```bash
cd server
pip install -r requirements.txt
python app.py
```

## 📁 Project Structure

```
ps171/
├── client/                    # Browser extension
│   ├── src/
│   │   ├── vision/           # Local vision processing
│   │   ├── redaction/        # PII redaction engine
│   │   ├── policy/           # Deterministic policy engine
│   │   └── manifest.json
│   └── dist/                 # Build output
├── server/                    # Server-side VLM planner
│   ├── models/               # VLM inference
│   ├── api/                  # REST endpoints
│   └── app.py
└── README.md
```

## 📈 Evaluation Metrics

PS171 is evaluated on the following metrics aligned with SIH requirements:

1. **Accuracy of Visual Context** (25%) - High-fidelity screen state interpretation
2. **Recall & Precision for PII Detection** (20%) - Effective sensitive element identification
3. **Precision of Redaction** (20%) - Accurate sanitization without data leakage
4. **Client-Side Resource Utilization** (20%) - Minimal CPU, memory, battery drain
5. **End-to-End Latency** (15%) - Fast task automation without perceivable delays

## 🔐 Security Considerations

- All model downloads are cryptographically validated
- Sensitive data is redacted locally before any network transmission
- Deterministic policy rules prevent unauthorized actions
- No raw credentials or PII bypass user control
- Works entirely offline for perception and redaction

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Team

Developed for Smart India Hackathon (SIH)

## 📞 Contact & Support

For issues, questions, or suggestions, please open an issue on GitHub or contact the development team.

## 🙏 Acknowledgments

- Built with **WebGPU**, **WebAssembly**, **ONNX Runtime Web**, and **Transformers.js**
- Uses **BlazeFace** for face detection
- Integrates **EasyOCR** for text recognition
- Leverages **SmolVLM** for efficient vision-language reasoning

---

**PS171: Decentralizing Privacy. Democratizing AI.**
