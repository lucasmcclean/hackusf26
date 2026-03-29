from google.adk.agents import LlmAgent, LoopAgent, ParallelAgent, SequentialAgent


MODEL = "gemini-2.5-flash"

PROJECT_CONTEXT = (
    "Mission: Build a Tampa Bay water-threat resilience emergency response system that connects "
    "distressed users with responders.\n"
    "Core product behavior:\n"
    "- Users and responders send chat messages with geo context.\n"
    "- Message history is stored in a RAG vector database.\n"
    "- Responders use map zoning and priority heatmaps to allocate response.\n"
    "- Responders can search message keywords to highlight relevant map nodes.\n"
    "- Regional reports are generated from chat evidence for responder decision-making.\n"
    "Strategy objective: produce actionable, equitable, safety-first plans for triage, zoning, "
    "and responder coordination."
)


def _safe_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _extract_source_evidence(result: object, max_items: int = 6) -> list[dict]:
    source_nodes = getattr(result, "source_nodes", None) or []
    evidence = []

    for source_node in source_nodes[:max_items]:
        node = getattr(source_node, "node", None)
        metadata = getattr(node, "metadata", {}) if node is not None else {}

        text = ""
        if node is not None and hasattr(node, "get_content"):
            try:
                text = _safe_text(node.get_content())
            except Exception:
                text = ""
        if not text:
            text = _safe_text(getattr(node, "text", ""))
        if not text:
            text = _safe_text(source_node)

        evidence.append(
            {
                "score": getattr(source_node, "score", None),
                "text": text,
                "metadata": metadata,
            }
        )

    return evidence


def _severity_signal_counts(chunks: list[str]) -> dict:
    lexicon = {
        "life_safety": ["help", "urgent", "trapped", "rescue", "emergency", "dying"],
        "medical": ["injured", "bleeding", "medical", "hospital", "asthma", "medicine"],
        "flooding": ["flood", "water rising", "storm surge", "inundated", "submerged"],
        "infrastructure": ["road closed", "bridge", "power", "outage", "blocked", "debris"],
        "resources": ["food", "water", "shelter", "evacuate", "generator", "transport"],
    }

    normalized = "\n".join(chunks).lower()
    counts = {}
    for category, terms in lexicon.items():
        counts[category] = sum(normalized.count(term) for term in terms)
    return counts


def retrieve_user_message_context(query: str, top_k: int = 5) -> dict:
    """RAG tool: query vectorized user messages for relevant historical context."""
    try:
        from users.user_message import query_user_messages

        result = query_user_messages(query_text=query, top_k=top_k)
        answer = _safe_text(getattr(result, "response", result))
        evidence = _extract_source_evidence(result)

        return {
            "status": "ok",
            "query": query,
            "top_k": top_k,
            "answer": answer,
            "evidence": evidence,
        }
    except Exception as exc:
        return {
            "status": "error",
            "query": query,
            "top_k": top_k,
            "answer": "",
            "evidence": [],
            "error": f"RAG retrieval failed: {exc}",
        }


def build_shared_strategy_context(user_prompt: str, top_k: int = 8) -> dict:
    """Builds shared context packet from project goals + multi-query user-message RAG retrieval."""
    cleaned_prompt = _safe_text(user_prompt)
    if not cleaned_prompt:
        cleaned_prompt = "Give best strategy"

    generic_prompts = {
        "strategy",
        "best strategy",
        "give best strategy",
        "what is the strategy",
        "plan",
    }
    prompt_is_generic = cleaned_prompt.lower() in generic_prompts

    base_queries = [
        "highest urgency distress messages requiring immediate rescue",
        "flooding and water-threat reports by users with location clues",
        "medical needs and vulnerable population indicators in user messages",
        "infrastructure and mobility failures impacting responder access",
        "resource requests including shelter, water, food, and evacuation",
    ]

    retrieval_queries = list(base_queries)
    if not prompt_is_generic:
        retrieval_queries.insert(0, cleaned_prompt)

    retrievals = [retrieve_user_message_context(query=q, top_k=top_k) for q in retrieval_queries]

    text_chunks = []
    for item in retrievals:
        text_chunks.append(_safe_text(item.get("answer")))
        for ev in item.get("evidence", []):
            text_chunks.append(_safe_text(ev.get("text")))

    severity_counts = _severity_signal_counts(text_chunks)
    max_count = max(severity_counts.values()) if severity_counts else 0
    inferred_priority = "high" if max_count >= 5 else "medium" if max_count >= 2 else "low"

    return {
        "status": "ok",
        "user_prompt": cleaned_prompt,
        "prompt_is_generic": prompt_is_generic,
        "mission_context": PROJECT_CONTEXT,
        "retrieval_queries": retrieval_queries,
        "retrievals": retrievals,
        "severity_signals": severity_counts,
        "inferred_priority": inferred_priority,
        "operational_focus": [
            "life safety first",
            "zone-level prioritization",
            "responder allocation",
            "equity for vulnerable communities",
            "clear responder communication",
        ],
    }


monitoring_agent = LlmAgent(
    name="monitoring_agent",
    model=MODEL,
    description="Builds a shared monitoring context from project mission and RAG evidence.",
    instruction=(
        "You are the Monitoring Agent for a Tampa Bay resilience response system. "
        "First call build_shared_strategy_context with the user's request. "
        "Then produce a concise monitoring snapshot with sections: Incident Signals, "
        "Urgency, Entities, Missing Data, One-Line Status, and Shared Context Packet. "
        "For Shared Context Packet, include the returned tool JSON.\n\n"
        "Mission context:\n"
        f"{PROJECT_CONTEXT}"
    ),
    tools=[build_shared_strategy_context, retrieve_user_message_context],
    output_key="monitoring_snapshot",
)


report_agent = LlmAgent(
    name="report_agent",
    model=MODEL,
    description="Creates a grounded SITREP from shared monitoring context.",
    instruction=(
        "You are the top-level Report Agent. Use monitoring snapshot and shared context packet "
        "to produce an actionable SITREP for responders. Include: Current Status, Key Risks, "
        "Affected Groups, and Recommended Next 3 Actions.\n\n"
        "Monitoring snapshot:\n{{monitoring_snapshot}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="global_report",
)


region_agent = LlmAgent(
    name="region_agent",
    model=MODEL,
    description="Creates zone-oriented regional assessment for map operations.",
    instruction=(
        "You are the top-level Region Agent. Use monitoring snapshot and shared context to propose "
        "zone-level assessment suitable for map pins and heatmaps. Include: Priority Zones, "
        "Confidence per Zone, Access Constraints, and Suggested Responder Staging.\n\n"
        "Monitoring snapshot:\n{{monitoring_snapshot}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="global_region_assessment",
)


strategy_region_agent = LlmAgent(
    name="strategy_region_agent",
    model=MODEL,
    description="Parallel strategy branch for tactical geospatial planning.",
    instruction=(
        "You are Strategy Region Agent inside strategy_3x_agent. Produce tactical geospatial strategy "
        "using the provided context. Include: zone ranking, responder routing assumptions, and "
        "high-priority map overlays to render.\n\n"
        "Monitoring snapshot:\n{{monitoring_snapshot}}\n\n"
        "Top-level region assessment:\n{{global_region_assessment}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="strategy_region",
)


strategy_report_agent = LlmAgent(
    name="strategy_report_agent",
    model=MODEL,
    description="Parallel strategy branch for communication and reporting plan.",
    instruction=(
        "You are Strategy Report Agent inside strategy_3x_agent. Produce tactical communications "
        "strategy using the provided context. Include: responder-facing briefing format, "
        "public-facing message priorities, and escalation triggers.\n\n"
        "Monitoring snapshot:\n{{monitoring_snapshot}}\n\n"
        "Top-level report:\n{{global_report}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="strategy_report",
)


strategy_parallel_agent = ParallelAgent(
    name="strategy_3x_agent",
    description="Runs regional and report strategy branches in parallel.",
    sub_agents=[strategy_region_agent, strategy_report_agent],
)


determination_decider_agent = LlmAgent(
    name="determination_decider_agent",
    model=MODEL,
    description="Synthesizes strategy branches into one operational plan.",
    instruction=(
        "You are the final decision step for determination_agent. Merge strategy_region and "
        "strategy_report into a single strategy answer for the user prompt. Output only the "
        "following sections:\n"
        "1) Best Strategy\n"
        "2) Priority Zones\n"
        "3) Triage Rules\n"
        "4) Responder Allocation\n"
        "5) 0-30 Minute Actions\n"
        "6) Confidence and Data Gaps\n\n"
        "Strategy region output:\n{{strategy_region}}\n\n"
        "Strategy report output:\n{{strategy_report}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="determination",
)


determination_agent = SequentialAgent(
    name="determination_agent",
    description="Runs parallel strategy analysis then synthesizes a final determination.",
    sub_agents=[strategy_parallel_agent, determination_decider_agent],
)


historian_agent = LlmAgent(
    name="historian_agent",
    model=MODEL,
    description="Tracks what changed across loop iterations for consistency.",
    instruction=(
        "You are Historian Agent. Compare current determination with prior history and create an "
        "updated history log with: Stable Signals, New Signals, Plan Changes, and Remaining Unknowns.\n\n"
        "Current determination:\n{{determination}}\n\n"
        "Existing history log:\n{{history_log}}"
    ),
    tools=[retrieve_user_message_context],
    output_key="history_log",
)


loop_agent = LoopAgent(
    name="loop_agent",
    description="Iterative orchestration for determination and historical consistency.",
    sub_agents=[determination_agent, historian_agent],
    max_iterations=2,
)


root_agent = SequentialAgent(
    name="orchestra_root",
    description=(
        "Orchestration root: monitoring, reporting, regional assessment, then looped "
        "determination with history tracking."
    ),
    sub_agents=[monitoring_agent, report_agent, region_agent, loop_agent],
)
