#pragma once

#include <KAbstractFileItemActionPlugin>

#include <QString>
#include <QStringList>
#include <QVariant>

#include <optional>

class KFileItemListProperties;

class SeafileIgnoreAction final : public KAbstractFileItemActionPlugin
{
	Q_OBJECT

public:
	explicit SeafileIgnoreAction(QObject *parent, const QVariantList &args);
	QList<QAction *> actions(const KFileItemListProperties &fileItemInfos, QWidget *parentWidget) override;

private:
	struct IgnoreItem {
		QString worktree;
		QString pattern;
	};

	QStringList repoDatabases() const;
	QStringList worktrees() const;
	std::optional<IgnoreItem> resolveItem(const QString &path, const QStringList &knownWorktrees) const;
	void addToIgnore(const QList<IgnoreItem> &items);
};
